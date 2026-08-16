import { toCents } from "@budget/shared";
import { eq, inArray, sql } from "drizzle-orm";
import type { Transaction as PlaidTransaction } from "plaid";
import db from "../db";
import {
  BankAccounts,
  PlaidItems,
  SplitIntents,
  type SplitIntentPart,
  TransactionSplits,
  Transactions,
} from "../db/schema";
import { decrypt } from "./crypto";
import { splittableMembers } from "./household";
import {
  postShareDeltas,
  shareTargetFor,
  type ShareTarget,
  type Tx,
} from "./ledger";
import { notify } from "./notify";
import { plaid, plaidErrorCode } from "./plaid";
import { sqlExcluded } from "./sql";
import {
  assertSplitsBalance,
  reallocateForAmountChange,
  resolveDefaultSplit,
  splitsToPairs,
  writeSplits,
  type SplitMethod,
  type SplitPart,
} from "./splits";

/** Keeps a single insert well under Postgres' 65535 bound-parameter limit. */
const WRITE_CHUNK = 500;
/** Reads bind one parameter per id, so they can be far larger than writes. */
const READ_CHUNK = 5_000;

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, iChunk) =>
    items.slice(iChunk * size, iChunk * size + size),
  );

/**
 * One row per `plaidTransactionId`, the last occurrence winning.
 *
 * A `Map` keyed on the id preserves first-insertion order while taking the last
 * value, which is what an upsert applied in arrival order would have produced.
 */
const dedupeLast = <T extends { plaidTransactionId: string }>(
  rows: T[],
): T[] =>
  rows.length === 0
    ? rows
    : [...new Map(rows.map((row) => [row.plaidTransactionId, row])).values()];

/** Plaid returns JSON numbers; `numeric` columns take strings. */
const toNumeric = (value: number | null | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? String(value) : null;

const loadItem = async (itemId: string) => {
  const item = await db.query.PlaidItems.findFirst({ where: { id: itemId } });

  if (!item) throw new Error(`Plaid item not found: ${itemId}`);

  return {
    item,
    // Null once the item is disconnected — the row survives, the credential
    // does not. Callers skip rather than throw.
    accessToken: item.accessToken ? decrypt(item.accessToken) : null,
  };
};

/**
 * The connection expired. Flag it so the UI can offer a Reconnect button, and
 * tell the user once — `dedupeKey` keeps a retry storm from spamming them.
 */
export const markLoginRequired = async (item: {
  id: string;
  userId: string;
  status: string;
  institutionName: string | null;
}) => {
  if (item.status === "login_required") return;

  await db
    .update(PlaidItems)
    .set({ status: "login_required" })
    .where(eq(PlaidItems.id, item.id));

  await notify({
    userId: item.userId,
    payload: {
      type: "bank_login_required",
      data: { itemId: item.id, institutionName: item.institutionName },
    },
    dedupeKey: `bank_login_required:${item.id}`,
  });
};

/** Upserts the item's accounts and refreshes their balances. */
export const syncItemAccounts = async (itemId: string) => {
  const { item, accessToken } = await loadItem(itemId);

  if (!accessToken) return [];

  const { data } = await plaid.accountsGet({ access_token: accessToken });

  if (data.accounts.length === 0) return [];

  const rows = data.accounts.map((account) => ({
    householdId: item.householdId,
    // Seeded from the item, then owned by the account. Deliberately absent from
    // the `set` list below, or every sync would revert a manual reassignment.
    ownerMemberId: item.ownerMemberId,
    plaidItemId: item.id,
    plaidAccountId: account.account_id,
    name: account.name,
    officialName: account.official_name,
    type: account.type as string,
    subtype: account.subtype as string | null,
    mask: account.mask,
    currentBalance: toNumeric(account.balances.current),
    availableBalance: toNumeric(account.balances.available),
    isoCurrencyCode: account.balances.iso_currency_code,
  }));

  return db
    .insert(BankAccounts)
    .values(rows)
    .onConflictDoUpdate({
      // Composite, not the old global unique on `plaid_account_id`: Plaid
      // account ids are unique per Item, not per bank, and a collision under
      // the global unique left the account parented to the wrong item — after
      // which `listAccountIds` never found it and every transaction for that
      // account was silently dropped, forever.
      target: [BankAccounts.plaidItemId, BankAccounts.plaidAccountId],
      set: {
        name: sqlExcluded("name"),
        officialName: sqlExcluded("official_name"),
        type: sqlExcluded("type"),
        subtype: sqlExcluded("subtype"),
        mask: sqlExcluded("mask"),
        currentBalance: sqlExcluded("current_balance"),
        availableBalance: sqlExcluded("available_balance"),
        isoCurrencyCode: sqlExcluded("iso_currency_code"),
        updatedAt: new Date(),
      },
    })
    .returning();
};

/** The pre-upsert state of a row, used to decide whether its money moved. */
type PreImage = {
  amount: string;
  bankAccountId: string;
  isoCurrencyCode: string | null;
};

/**
 * The single place transactions enter the database.
 *
 * Pulls every page of `/transactions/sync`, then writes the whole delta, the
 * split changes it implies, the ledger deltas those imply, and the new cursor
 * in one transaction — the cursor only advances once the rows it describes are
 * durable, so a crash mid-sync replays instead of losing data.
 */
export const syncItemTransactions = async (itemId: string) => {
  const { item, accessToken } = await loadItem(itemId);

  if (!accessToken) return { added: 0, modified: 0, removed: 0 };

  const added: PlaidTransaction[] = [];
  const modified: PlaidTransaction[] = [];
  const removed: string[] = [];

  let cursor = item.cursor ?? undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const { data } = await plaid.transactionsSync({
        access_token: accessToken,
        // Omitted entirely on a first sync — Plaid rejects an explicit null.
        ...(cursor ? { cursor } : {}),
      });

      added.push(...data.added);
      modified.push(...data.modified);
      removed.push(...data.removed.map((r) => r.transaction_id));

      cursor = data.next_cursor;
      hasMore = data.has_more;
    }
  } catch (err) {
    if (plaidErrorCode(err) === "ITEM_LOGIN_REQUIRED") {
      await markLoginRequired(item);
      return { added: 0, modified: 0, removed: 0 };
    }

    await db
      .update(PlaidItems)
      .set({ status: "error" })
      .where(eq(PlaidItems.id, item.id));

    throw err;
  }

  const upserts = [...added, ...modified];
  let accountIds = await listAccountIds(item.id);

  // A new account can appear at the institution between syncs; its transactions
  // arrive before we've ever seen the account, so refresh once and retry.
  if (upserts.some((t) => !accountIds.has(t.account_id))) {
    await syncItemAccounts(item.id);
    accountIds = await listAccountIds(item.id);
  }

  // One row per Plaid id, last occurrence winning.
  //
  // A single `/transactions/sync` response set may carry the same id in more
  // than one array across its pages — `added` then `modified` is the ordinary
  // pending→posted case. Two rows with the same conflict target inside one
  // `INSERT ... ON CONFLICT DO UPDATE` is a hard Postgres error ("cannot affect
  // row a second time") that aborts the whole sync, and two rows split across
  // `WRITE_CHUNK` boundaries instead return two post-images, which become two
  // ledger targets for one ref. Applying only the last state is what Plaid's own
  // pagination contract asks for anyway.
  const rows = dedupeLast(
    upserts.flatMap((t) => {
      const account = accountIds.get(t.account_id);
      if (!account) return []; // account Plaid never returned — skip

      return [
        {
          householdId: item.householdId,
          bankAccountId: account.id,
          // From the ACCOUNT, not the item: `household.setAccountOwner` moves
          // the account's owner and nothing else, so reading the item's owner
          // here would make every reassignment invisible to the rows after it.
          // Seeded here and frozen by the CASE in the `set` list below.
          creditorMemberId: account.ownerMemberId,
          plaidTransactionId: t.transaction_id,
          plaidPendingTransactionId: t.pending_transaction_id ?? null,
          // Verbatim from Plaid: positive means money LEFT the account.
          amount: String(t.amount),
          isoCurrencyCode: t.iso_currency_code,
          date: t.date,
          authorizedDate: t.authorized_date,
          name: t.name,
          merchantName: t.merchant_name ?? null,
          category: t.personal_finance_category?.primary ?? null,
          categoryDetailed: t.personal_finance_category?.detailed ?? null,
          paymentChannel: t.payment_channel as string,
          pending: t.pending,
          logoUrl: t.logo_url ?? null,
        },
      ];
    }),
  );

  await db.transaction(async (tx) => {
    // Serializes this item against a concurrent sync of the same item — the
    // inline pull-to-refresh path and the pg-boss worker can both be here at
    // once, and `singletonKey` only dedupes queued jobs. Also fixes the
    // pre-existing cursor race between those two paths.
    await tx.execute(
      sql`select id from plaid_items where id = ${item.id} for update`,
    );

    const preImages = await loadPreImages(
      tx,
      rows.map((row) => row.plaidTransactionId),
    );

    const postImages: PostImage[] = [];

    for (const batch of chunk(rows, WRITE_CHUNK)) {
      // Upsert, not insert: `modified` is how a pending charge becomes posted,
      // and it must update in place rather than duplicate.
      const returned = await tx
        .insert(Transactions)
        .values(batch)
        .onConflictDoUpdate({
          target: Transactions.plaidTransactionId,
          // ── LOAD-BEARING ─────────────────────────────────────────────────
          // `splitMethod`, `splitsStale`, `splitUpdatedAt` and the splits table
          // are absent from this list *by construction*. That is the only thing
          // protecting every manual split from every future re-sync. Replacing
          // this enumeration with a spread would silently and permanently
          // discard the user's intent on the next webhook.
          set: {
            bankAccountId: sqlExcluded("bank_account_id"),
            plaidPendingTransactionId: sqlExcluded(
              "plaid_pending_transaction_id",
            ),
            amount: sqlExcluded("amount"),
            isoCurrencyCode: sqlExcluded("iso_currency_code"),
            date: sqlExcluded("date"),
            authorizedDate: sqlExcluded("authorized_date"),
            name: sqlExcluded("name"),
            merchantName: sqlExcluded("merchant_name"),
            category: sqlExcluded("category"),
            categoryDetailed: sqlExcluded("category_detailed"),
            paymentChannel: sqlExcluded("payment_channel"),
            pending: sqlExcluded("pending"),
            logoUrl: sqlExcluded("logo_url"),
            // The payer only changes when Plaid actually moved the row to a
            // different account. Re-deriving it from the account's *current*
            // owner would let a routine one-cent modify re-post months of
            // shares against a new creditor and drain the old pair to zero.
            // All SET expressions see the pre-update row, so comparing against
            // `excluded` here is safe regardless of ordering in this list.
            creditorMemberId: sql`case
              when ${Transactions.bankAccountId} <> excluded.bank_account_id
              then excluded.creditor_member_id
              else ${Transactions.creditorMemberId} end`,
            updatedAt: new Date(),
          },
        })
        .returning({
          id: Transactions.id,
          householdId: Transactions.householdId,
          plaidTransactionId: Transactions.plaidTransactionId,
          plaidPendingTransactionId: Transactions.plaidPendingTransactionId,
          bankAccountId: Transactions.bankAccountId,
          creditorMemberId: Transactions.creditorMemberId,
          // Already normalized to scale 2 by the column, unlike the Plaid
          // payload, which stringifies $20.00 as "20".
          amount: Transactions.amount,
          date: Transactions.date,
          isoCurrencyCode: Transactions.isoCurrencyCode,
          name: Transactions.name,
          merchantName: Transactions.merchantName,
          category: Transactions.category,
          categoryDetailed: Transactions.categoryDetailed,
          splitMethod: Transactions.splitMethod,
          // Postgres cannot RETURN the OLD row from ON CONFLICT DO UPDATE, and
          // `xmax <> 0` only says *that* it updated. This says which.
          inserted: sql<boolean>`(xmax = 0)`,
        });

      postImages.push(...returned);
    }

    // Entries are NOT NULL on currency, and Plaid nulls `iso_currency_code`
    // whenever it sets `unofficial_currency_code` — falling back to the
    // household's own currency keeps a NULL from ever reaching the ledger.
    const household = await tx.query.Households.findFirst({
      where: { id: item.householdId },
      columns: { defaultCurrency: true },
    });
    const defaultCurrency = household?.defaultCurrency ?? "USD";

    const targets: ShareTarget[] = [];

    if (postImages.length > 0) {
      targets.push(
        ...(await resolveSplitChanges(tx, {
          householdId: item.householdId,
          defaultCurrency,
          postImages,
          preImages,
        })),
      );
    }

    targets.push(
      ...(await reverseRemoved(tx, {
        householdId: item.householdId,
        defaultCurrency,
        removed,
      })),
    );

    for (const batch of chunk(removed, WRITE_CHUNK)) {
      await tx
        .delete(Transactions)
        .where(inArray(Transactions.plaidTransactionId, batch));
    }

    // One batched call for the whole delta.
    await postShareDeltas(tx, { householdId: item.householdId, targets });

    await tx
      .update(PlaidItems)
      .set({ cursor, lastSyncedAt: new Date(), status: "active" })
      .where(eq(PlaidItems.id, item.id));
  });

  return {
    added: added.length,
    modified: modified.length,
    removed: removed.length,
  };
};

/**
 * Runs an id-keyed read in `READ_CHUNK`-sized batches and returns every row.
 *
 * The four loaders below are all "select some rows for these ids, fold them
 * into a Map"; batching is the only part they share, so it is stated once here
 * and each caller stays a select plus a fold. Ids are deduped on the way in —
 * a repeated id would otherwise fold its rows twice, which matters for the
 * loaders that accumulate into an array rather than overwrite.
 */
const loadChunked = async <R>(
  ids: readonly string[],
  select: (batch: string[]) => Promise<R[]>,
): Promise<R[]> => {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows: R[] = [];

  for (const batch of chunk(unique, READ_CHUNK)) {
    rows.push(...(await select(batch)));
  }

  return rows;
};

const loadPreImages = async (tx: Tx, plaidTransactionIds: string[]) => {
  const rows = await loadChunked(plaidTransactionIds, (batch) =>
    tx
      .select({
        plaidTransactionId: Transactions.plaidTransactionId,
        amount: Transactions.amount,
        bankAccountId: Transactions.bankAccountId,
        isoCurrencyCode: Transactions.isoCurrencyCode,
      })
      .from(Transactions)
      .where(inArray(Transactions.plaidTransactionId, batch)),
  );

  return new Map<string, PreImage>(
    rows.map((row) => [row.plaidTransactionId, row]),
  );
};

/** A freshly inserted post whose pending row may carry a split intent forward. */
const hasCarriedIntent = (
  post: PostImage,
): post is PostImage & { plaidPendingTransactionId: string } =>
  post.inserted && post.plaidPendingTransactionId !== null;

type PostImage = {
  id: string;
  householdId: string;
  plaidTransactionId: string;
  plaidPendingTransactionId: string | null;
  bankAccountId: string;
  creditorMemberId: string;
  amount: string;
  date: string;
  isoCurrencyCode: string | null;
  name: string;
  merchantName: string | null;
  category: string | null;
  categoryDetailed: string | null;
  splitMethod: SplitMethod;
  inserted: boolean;
};

/**
 * Decides what happened to each row's splits, writes them, and returns the
 * ledger targets they imply.
 *
 * Rows whose money did not move are skipped entirely — that is what makes a
 * re-sync of unchanged data write nothing at all.
 */
const resolveSplitChanges = async (
  tx: Tx,
  args: {
    householdId: string;
    defaultCurrency: string;
    postImages: PostImage[];
    preImages: Map<string, PreImage>;
  },
): Promise<ShareTarget[]> => {
  const { householdId, defaultCurrency, postImages, preImages } = args;

  const changed = postImages.filter((post) => {
    const pre = preImages.get(post.plaidTransactionId);
    if (!pre) return true; // freshly inserted

    // Money-relevant means amount, account, or currency. A name, category,
    // logo or pending->posted flip on the same id changes nothing that the
    // ledger cares about.
    //
    // Compare cents, never the raw strings: plaid-sync writes String(20) as
    // "20" while the column round-trips "20.00", so a string compare would
    // mark every whole-dollar transaction as changed on every sync.
    return (
      toCents(pre.amount) !== toCents(post.amount) ||
      pre.bankAccountId !== post.bankAccountId ||
      pre.isoCurrencyCode !== post.isoCurrencyCode
    );
  });

  if (changed.length === 0) return [];

  const [accounts, members, existingSplits, intents] = await Promise.all([
    listAccountDefaults(
      tx,
      changed.map((post) => post.bankAccountId),
    ),
    splittableMembers(householdId),
    loadSplits(
      tx,
      changed.filter((post) => !post.inserted).map((post) => post.id),
    ),
    loadIntents(
      tx,
      changed
        .filter(hasCarriedIntent)
        .map((post) => post.plaidPendingTransactionId),
    ),
  ]);

  const memberIds = members.map((member) => member.id);
  const targets: ShareTarget[] = [];

  for (const post of changed) {
    const account = accounts.get(post.bankAccountId);
    if (!account) continue;

    const totalCents = toCents(post.amount);
    const existing = existingSplits.get(post.id) ?? [];

    // A pending charge is retired under a new id; carry its intent across so a
    // hand-typed split does not silently die two days later.
    const carried = post.plaidPendingTransactionId
      ? intents.get(post.plaidPendingTransactionId)
      : undefined;

    const resolved =
      existing.length > 0
        ? reallocateForAmountChange({
            method: post.splitMethod,
            creditorMemberId: post.creditorMemberId,
            existing,
            newCents: totalCents,
          })
        : carried
          ? // Through the same function the amount-change path uses, rather than
            // a second implementation of it: the pending and posted amounts
            // routinely differ (a tip), and re-running the allocator over an
            // `exact` intent's weights — which `setSplit` writes as all 1s —
            // would turn a hand-typed split into an equal one.
            reallocateForAmountChange({
              method: carried.method,
              creditorMemberId: post.creditorMemberId,
              existing: carried.parts.map((part) => ({
                memberId: part.memberId,
                weight: part.weight,
                // Absent on rows archived before the cents were carried; zero
                // reads as "no exact intent recorded", which sends `exact` down
                // the reset path rather than inventing amounts for it.
                amountCents: part.amountCents ?? 0,
              })),
              newCents: totalCents,
            })
          : {
              ...resolveDefaultSplit({
                creditorMemberId: post.creditorMemberId,
                totalCents,
                transaction: post,
                account,
                householdCurrency: defaultCurrency,
                memberIds,
              }),
              splitsStale: false,
            };

    assertSplitsBalance({
      amount: post.amount,
      context: post.plaidTransactionId,
      parts: resolved.parts,
    });

    await writeSplits(tx, {
      householdId: post.householdId,
      transactionId: post.id,
      parts: resolved.parts,
      isNewTransaction: post.inserted,
    });

    await tx
      .update(Transactions)
      .set({
        splitMethod: resolved.method,
        splitsStale: resolved.splitsStale,
        isPrivate: account.isPrivate,
      })
      .where(eq(Transactions.id, post.id));

    targets.push(
      shareTargetFor(
        post,
        defaultCurrency,
        splitsToPairs(post.creditorMemberId, resolved.parts),
      ),
    );
  }

  return targets;
};

/**
 * Reverses everything posted for each removed transaction, and archives any
 * hand-made split first.
 *
 * A repeated `removed` finds no row, produces no target, and posts nothing —
 * idempotent without a dedupe table. The archive is keyed by Plaid's id rather
 * than ours because the posted charge can arrive in a *later* sync response
 * than the removal, by which point our row and its splits are gone.
 */
const reverseRemoved = async (
  tx: Tx,
  args: { householdId: string; defaultCurrency: string; removed: string[] },
): Promise<ShareTarget[]> => {
  const { householdId, defaultCurrency, removed } = args;

  if (removed.length === 0) return [];

  const targets: ShareTarget[] = [];

  for (const batch of chunk(removed, READ_CHUNK)) {
    const rows = await tx
      .select({
        id: Transactions.id,
        plaidTransactionId: Transactions.plaidTransactionId,
        splitMethod: Transactions.splitMethod,
        date: Transactions.date,
        isoCurrencyCode: Transactions.isoCurrencyCode,
        name: Transactions.name,
        merchantName: Transactions.merchantName,
      })
      .from(Transactions)
      .where(inArray(Transactions.plaidTransactionId, batch));

    if (rows.length === 0) continue;

    const splits = await loadSplits(
      tx,
      rows.filter((row) => row.splitMethod !== "owner").map((row) => row.id),
    );

    const archives = rows.flatMap((row) => {
      const parts = splits.get(row.id);
      if (!parts || parts.length === 0) return [];

      return [
        {
          plaidTransactionId: row.plaidTransactionId,
          householdId,
          splitMethod: row.splitMethod,
          parts: parts.map((part) => ({
            memberId: part.memberId,
            weight: part.weight,
            amountCents: part.amountCents,
          })),
        },
      ];
    });

    if (archives.length > 0) {
      await tx
        .insert(SplitIntents)
        .values(archives)
        .onConflictDoUpdate({
          target: SplitIntents.plaidTransactionId,
          set: {
            splitMethod: sqlExcluded("split_method"),
            parts: sqlExcluded("parts"),
          },
        });
    }

    // The rows are about to be deleted, hence the null id; each entry keeps its
    // memo and date so it still reads correctly once detached. Empty pairs
    // reverse every posted pair to exactly zero.
    targets.push(
      ...rows.map((row) =>
        shareTargetFor({ ...row, id: null }, defaultCurrency, []),
      ),
    );
  }

  return targets;
};

const listAccountDefaults = async (tx: Tx, bankAccountIds: string[]) => {
  const rows = await loadChunked(bankAccountIds, (batch) =>
    tx
      .select({
        id: BankAccounts.id,
        defaultSplit: BankAccounts.defaultSplit,
        defaultSplitFrom: BankAccounts.defaultSplitFrom,
        isPrivate: BankAccounts.isPrivate,
        excludedAt: BankAccounts.excludedAt,
      })
      .from(BankAccounts)
      .where(inArray(BankAccounts.id, batch)),
  );

  return new Map(rows.map((row) => [row.id, row]));
};

const loadSplits = async (tx: Tx, transactionIds: string[]) => {
  const rows = await loadChunked(transactionIds, (batch) =>
    tx
      .select({
        transactionId: TransactionSplits.transactionId,
        memberId: TransactionSplits.memberId,
        weight: TransactionSplits.weight,
        amountCents: TransactionSplits.amountCents,
      })
      .from(TransactionSplits)
      .where(inArray(TransactionSplits.transactionId, batch)),
  );

  const byTransaction = new Map<string, SplitPart[]>();

  for (const row of rows) {
    const parts = byTransaction.get(row.transactionId) ?? [];
    parts.push({
      memberId: row.memberId,
      weight: row.weight,
      amountCents: row.amountCents,
    });
    byTransaction.set(row.transactionId, parts);
  }

  return byTransaction;
};

const loadIntents = async (tx: Tx, plaidTransactionIds: string[]) => {
  const rows = await loadChunked(plaidTransactionIds, (batch) =>
    tx
      .select()
      .from(SplitIntents)
      .where(inArray(SplitIntents.plaidTransactionId, batch)),
  );

  return new Map<
    string,
    {
      method: SplitMethod;
      parts: SplitIntentPart[];
    }
  >(
    rows.map((row) => [
      row.plaidTransactionId,
      { method: row.splitMethod, parts: row.parts },
    ]),
  );
};

/**
 * Plaid's account id → our row, carrying the owner alongside the id.
 *
 * The owner comes from the ACCOUNT, never from the item: `syncItemAccounts`
 * keeps `owner_member_id` out of its `set` list precisely so
 * `household.setAccountOwner` survives a sync, and reading the item's owner here
 * would make that reassignment a no-op for every transaction that follows it.
 */
const listAccountIds = async (plaidItemId: string) => {
  const accounts = await db
    .select({
      id: BankAccounts.id,
      plaidAccountId: BankAccounts.plaidAccountId,
      ownerMemberId: BankAccounts.ownerMemberId,
    })
    .from(BankAccounts)
    .where(eq(BankAccounts.plaidItemId, plaidItemId));

  return new Map(
    accounts.map((a) => [
      a.plaidAccountId,
      { id: a.id, ownerMemberId: a.ownerMemberId },
    ]),
  );
};
