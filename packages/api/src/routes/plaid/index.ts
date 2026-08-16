import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { CountryCode, Products } from "plaid";
import { z } from "zod";
import db from "../../db";
import {
  BankAccounts,
  HouseholdMembers,
  Households,
  LedgerEntries,
  PlaidItems,
  Transactions,
} from "../../db/schema";
import { encrypt, decrypt } from "../../lib/crypto";
import { env } from "../../env";
import { plaid } from "../../lib/plaid";
import { enqueuePlaidSync } from "../../lib/plaid-queue";
import { syncItemAccounts, syncItemTransactions } from "../../lib/plaid-sync";
import { toIso } from "../../lib/serialize";
import { householdProcedure, router } from "../../lib/trpc";

const CLIENT_NAME = "Budget";
const COUNTRY_CODES = [CountryCode.Us];
/** 24 months. Must be requested at Link time — it cannot be raised later. */
const DAYS_REQUESTED = 730;

/** A sync that outruns this keeps going in the background; we just stop waiting. */
const SYNC_NOW_TIMEOUT_MS = 20_000;

const householdItem = async ({
  householdId,
  itemId,
}: {
  householdId: string;
  itemId: string;
}) => {
  const item = await db.query.PlaidItems.findFirst({
    where: { id: itemId, householdId },
  });

  if (!item) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Item not found" });
  }

  return item;
};

/** The rows one item is responsible for, always scoped to the household too. */
const underItem = ({
  householdId,
  plaidItemId,
}: {
  householdId: string;
  plaidItemId: string;
}) =>
  and(
    eq(Transactions.householdId, householdId),
    eq(BankAccounts.plaidItemId, plaidItemId),
  );

export const plaidRouter = router({
  /**
   * Mints the short-lived token that Plaid Link opens with. Passing an
   * `itemId` produces an update-mode token — the reconnect path for an item
   * whose credentials expired.
   */
  createLinkToken: householdProcedure
    .input(z.object({ itemId: z.uuid().optional() }))
    .mutation(async (opts) => {
      const { user, householdId } = opts.ctx;
      const { itemId } = opts.input;

      const updateFor = itemId
        ? await householdItem({ householdId, itemId })
        : null;

      // Disconnecting nulls the credential, and update mode has nothing to
      // re-authenticate without one. The way back is a fresh Link, not this.
      if (updateFor && !updateFor.accessToken) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This bank was disconnected — connect it again",
        });
      }

      const { data } = await plaid.linkTokenCreate({
        client_name: CLIENT_NAME,
        language: "en",
        country_codes: COUNTRY_CODES,
        user: { client_user_id: user.id },
        ...(env.PLAID_WEBHOOK_URL ? { webhook: env.PLAID_WEBHOOK_URL } : {}),
        ...(updateFor?.accessToken
          ? // Update mode: no `products`, Plaid re-authenticates the existing item.
            { access_token: decrypt(updateFor.accessToken) }
          : {
              products: [Products.Transactions],
              transactions: { days_requested: DAYS_REQUESTED },
            }),
      });

      return { linkToken: data.link_token };
    }),

  /**
   * Trades the device's one-time public token for a permanent access token.
   * The access token is encrypted before it touches the database and is never
   * returned to the client.
   */
  exchangePublicToken: householdProcedure
    .input(z.object({ publicToken: z.string() }))
    .mutation(async (opts) => {
      const { user, member, householdId } = opts.ctx;

      const { data: exchange } = await plaid.itemPublicTokenExchange({
        public_token: opts.input.publicToken,
      });

      const institution = await fetchInstitution(exchange.access_token);
      const accessToken = encrypt(exchange.access_token);

      const [item] = await db
        .insert(PlaidItems)
        .values({
          householdId,
          userId: user.id,
          // The seat that gets paid back for everything on these accounts. The
          // linking member, not the household owner.
          ownerMemberId: member.id,
          plaidItemId: exchange.item_id,
          accessToken,
          status: "syncing",
          ...institution,
        })
        .onConflictDoUpdate({
          target: PlaidItems.plaidItemId,
          // `ownerMemberId` is deliberately absent: re-exchanging an item must
          // never silently reassign who is owed for its transactions.
          set: {
            accessToken,
            status: "syncing",
            disconnectedAt: null,
            ...institution,
          },
          // Scoped to the household so re-exchanging cannot move an item
          // between households — a double-tap updates your own row or nothing.
          setWhere: eq(PlaidItems.householdId, householdId),
        })
        .returning({
          id: PlaidItems.id,
          institutionId: PlaidItems.institutionId,
        });

      if (!item) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This bank connection belongs to another household",
        });
      }

      // Accounts first — transactions reference them.
      const accounts = await syncItemAccounts(item.id);
      await enqueuePlaidSync(item.id);

      return {
        itemId: item.id,
        duplicateOf: await findDuplicateAccount({
          householdId,
          userId: user.id,
          plaidItemId: item.id,
          institutionId: item.institutionId,
          accounts,
        }),
      };
    }),

  items: router({
    /** Items with their accounts nested, so the screen is one query. */
    list: householdProcedure.query(async (opts) => {
      const items = await db.query.PlaidItems.findMany({
        where: { householdId: opts.ctx.householdId },
        // Explicit columns — `accessToken` must never reach the client.
        columns: {
          id: true,
          institutionName: true,
          institutionLogoUrl: true,
          status: true,
          lastSyncedAt: true,
          disconnectedAt: true,
        },
        with: {
          accounts: {
            columns: {
              id: true,
              name: true,
              officialName: true,
              type: true,
              subtype: true,
              mask: true,
              currentBalance: true,
              availableBalance: true,
              isoCurrencyCode: true,
              ownerMemberId: true,
              isPrivate: true,
              defaultSplit: true,
              defaultSplitFrom: true,
              excludedAt: true,
            },
            // Without this Postgres is free to return the accounts in a
            // different order each call, and the settings list reshuffles under
            // the user between refetches.
            orderBy: { createdAt: "asc" },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      return items.map((item) => ({
        ...item,
        lastSyncedAt: toIso(item.lastSyncedAt),
        disconnectedAt: toIso(item.disconnectedAt),
        accounts: item.accounts.map((account) => {
          const yours = account.ownerMemberId === opts.ctx.member.id;

          return {
            ...account,
            excludedAt: toIso(account.excludedAt),
            // A private account still appears in the list — the household can
            // see that it exists and who owns it — but its balances are
            // withheld. `transactions.list` already hides its rows, and the
            // live balance is the more sensitive of the two.
            currentBalance:
              account.isPrivate && !yours ? null : account.currentBalance,
            availableBalance:
              account.isPrivate && !yours ? null : account.availableBalance,
          };
        }),
      }));
    }),

    /** What a purge would actually cost, so the dialog can name it up front. */
    impact: householdProcedure
      .input(z.object({ itemId: z.uuid() }))
      .query(async (opts) => {
        const { householdId } = opts.ctx;
        const item = await householdItem({
          householdId,
          itemId: opts.input.itemId,
        });

        // Both walk the item's whole history, and neither depends on the other.
        const [[counted], outstanding] = await Promise.all([
          db
            .select({ transactions: sql<string>`count(*)` })
            .from(Transactions)
            .innerJoin(
              BankAccounts,
              eq(BankAccounts.id, Transactions.bankAccountId),
            )
            .where(underItem({ householdId, plaidItemId: item.id })),
          db
            .select({
              currency: LedgerEntries.isoCurrencyCode,
              cents: sql<string>`sum(${LedgerEntries.amountCents})`,
            })
            .from(LedgerEntries)
            .innerJoin(
              Transactions,
              eq(Transactions.id, LedgerEntries.transactionId),
            )
            .innerJoin(
              BankAccounts,
              eq(BankAccounts.id, Transactions.bankAccountId),
            )
            .where(
              and(
                eq(LedgerEntries.householdId, householdId),
                underItem({ householdId, plaidItemId: item.id }),
              ),
            )
            .groupBy(LedgerEntries.isoCurrencyCode)
            .orderBy(LedgerEntries.isoCurrencyCode),
        ]);

        return {
          // `count` and `sum` cross node-postgres as strings — a bigint does not
          // fit a JS number in the general case, so pg refuses to guess.
          transactions: Number(counted?.transactions ?? 0),
          outstanding: outstanding
            .map((row) => ({
              cents: Number(row.cents),
              currency: row.currency,
            }))
            // Gross debt raised by this item's rows, not a net balance:
            // settlements belong to a pair, not to an item. A run that fully
            // refunded itself nets to zero and is not damage worth naming.
            .filter((row) => row.cents !== 0),
        };
      }),

    /**
     * Soft disconnect: revoke at Plaid, drop the credential, keep the row.
     *
     * Deleting the item cascades its accounts and every transaction under them,
     * and once money is owed that silently erases a real debt — the roommate
     * still owes $340 for a phone bill nobody can see any more. `items.purge`
     * is the deliberate, confirmed path for actually destroying data.
     */
    remove: householdProcedure
      .input(z.object({ itemId: z.uuid() }))
      .mutation(async (opts) => {
        const { user, householdId } = opts.ctx;
        const item = await householdItem({
          householdId,
          itemId: opts.input.itemId,
        });

        // Refused *before* the revoke, not only by the UPDATE below. Everyone in
        // the household can name this item, `itemRemove` is irreversible, and
        // failing the check afterwards would leave the connection dead at Plaid
        // while our row still reads `active` with a live-looking credential —
        // every later sync fails and the UI shows nothing wrong.
        if (item.userId !== user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Only the member who connected this bank can disconnect it",
          });
        }

        if (item.accessToken) {
          try {
            await plaid.itemRemove({ access_token: decrypt(item.accessToken) });
          } catch (err) {
            // Already gone at Plaid (or unrecoverable) — still drop our copy of
            // the credential, otherwise the user is stuck with a connection
            // they cannot disconnect.
            console.error("plaid.itemRemove failed:", err);
          }
        }

        // `user_id` on top of the household scope: everyone shares the data, but
        // revoking a credential is the act of the member who supplied it. The
        // check above reads the row; this one is the check that actually gates
        // the write.
        const [disconnected] = await db
          .update(PlaidItems)
          .set({
            status: "disconnected",
            accessToken: null,
            cursor: null,
            disconnectedAt: new Date(),
          })
          .where(
            and(
              eq(PlaidItems.id, item.id),
              eq(PlaidItems.householdId, householdId),
              eq(PlaidItems.userId, user.id),
            ),
          )
          .returning({ id: PlaidItems.id });

        if (!disconnected) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Only the member who connected this bank can disconnect it",
          });
        }

        return { itemId: item.id };
      }),

    /**
     * The destructive path: the item, its accounts and every transaction under
     * them, gone. `confirm` is required because none of it comes back.
     */
    purge: householdProcedure
      .input(z.object({ itemId: z.uuid(), confirm: z.literal(true) }))
      .mutation(async (opts) => {
        const { user, householdId } = opts.ctx;
        const item = await householdItem({
          householdId,
          itemId: opts.input.itemId,
        });

        // The same gate as `remove`, and for a stronger reason: this one is
        // irreversible and destroys history the whole household can see. Anyone
        // being able to purge a connection they did not contribute would let one
        // member delete another's bank data outright.
        if (item.userId !== user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only the member who connected this bank can delete it",
          });
        }

        if (item.accessToken) {
          try {
            await plaid.itemRemove({ access_token: decrypt(item.accessToken) });
          } catch (err) {
            // Purging a still-connected item must not leave the credential live
            // at Plaid with nothing left in our database pointing at it.
            console.error("plaid.itemRemove failed:", err);
          }
        }

        const deletedTransactions = await db.transaction(async (tx) => {
          const [counted] = await tx
            .select({ transactions: sql<string>`count(*)` })
            .from(Transactions)
            .innerJoin(
              BankAccounts,
              eq(BankAccounts.id, Transactions.bankAccountId),
            )
            .where(underItem({ householdId, plaidItemId: item.id }));

          // Deleting your data must not delete what you owe. `transaction_id` is
          // a convenience join, not the entry — the amount, memo and date were
          // frozen onto the row at post time, so the debt survives detached and
          // still reads as "Luigi's — Aug 3 — $50". The FK is ON DELETE SET
          // NULL, so this is belt-and-braces; it runs in the same transaction as
          // the delete so the two can never disagree.
          await tx
            .update(LedgerEntries)
            .set({ transactionId: null })
            .where(
              and(
                eq(LedgerEntries.householdId, householdId),
                inArray(
                  LedgerEntries.transactionId,
                  tx
                    .select({ id: Transactions.id })
                    .from(Transactions)
                    .innerJoin(
                      BankAccounts,
                      eq(BankAccounts.id, Transactions.bankAccountId),
                    )
                    .where(underItem({ householdId, plaidItemId: item.id })),
                ),
              ),
            );

          await tx
            .delete(PlaidItems)
            .where(
              and(
                eq(PlaidItems.id, item.id),
                eq(PlaidItems.householdId, householdId),
                eq(PlaidItems.userId, user.id),
              ),
            );

          return Number(counted?.transactions ?? 0);
        });

        return { itemId: item.id, deletedTransactions };
      }),
  }),

  /**
   * Awaited on purpose: this backs pull-to-refresh, and a fire-and-forget
   * enqueue would resolve instantly and show the user unchanged data.
   */
  syncNow: householdProcedure
    .input(z.object({ itemId: z.uuid().optional() }).optional())
    .mutation(async (opts) => {
      const { householdId } = opts.ctx;
      const itemId = opts.input?.itemId;

      const items: { id: string; status: string }[] = itemId
        ? [await householdItem({ householdId, itemId })]
        : await db.query.PlaidItems.findMany({
            where: { householdId },
            columns: { id: true, status: true },
          });

      // A disconnected item has no credential left to sync with.
      const syncable = items.filter((item) => item.status !== "disconnected");

      const totals = { added: 0, modified: 0, removed: 0 };
      let failure: unknown;

      // The catch is attached eagerly: if a sync fails *after* the timeout has
      // already won the race, an unattached rejection would crash the process.
      const work = Promise.all(
        syncable.map(async (item) => {
          const result = await syncItemTransactions(item.id);
          totals.added += result.added;
          totals.modified += result.modified;
          totals.removed += result.removed;
        }),
      ).catch((err: unknown) => {
        failure = err;
      });

      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        work,
        new Promise((resolve) => {
          timer = setTimeout(resolve, SYNC_NOW_TIMEOUT_MS);
        }),
      ]);
      clearTimeout(timer);

      if (failure) {
        console.error("syncNow failed:", failure);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Sync failed",
        });
      }

      // On timeout the sync keeps running and its next result lands via the
      // normal query invalidation; the partial totals here are honest.
      return totals;
    }),
});

/** Best-effort branding for the connected institution — never fatal. */
const fetchInstitution = async (accessToken: string) => {
  try {
    const { data: itemData } = await plaid.itemGet({
      access_token: accessToken,
    });

    const institutionId = itemData.item.institution_id;
    if (!institutionId) return {};

    const { data } = await plaid.institutionsGetById({
      institution_id: institutionId,
      country_codes: COUNTRY_CODES,
      options: { include_optional_metadata: true },
    });

    return {
      institutionId,
      institutionName: data.institution.name,
      // Plaid returns a base64 PNG, not a URL. Wrapping it as a data URI keeps
      // the column a single "something an <Image> can render".
      institutionLogoUrl: data.institution.logo
        ? `data:image/png;base64,${data.institution.logo}`
        : null,
    };
  } catch (err) {
    console.error("Failed to fetch institution metadata:", err);
    return {};
  }
};

/**
 * An account in this household that the freshly linked one appears to duplicate.
 *
 * Two members each linking the same joint account is the single most likely way
 * a shared household double-counts everything: the same charge arrives under two
 * items, gets split twice, and every balance is silently wrong. Plaid account
 * ids are per-Item, so the only comparable identity is
 * (institution, mask, type, subtype).
 *
 * Advisory only — the client warns, the user decides. Blocking the connect would
 * be wrong: two people really can hold separate accounts with the same last four
 * at the same bank.
 */
const findDuplicateAccount = async (args: {
  householdId: string;
  /**
   * The linking user, so the search can cross into their *other* households.
   *
   * This is the sharper case by far, and it only became reachable when a user
   * could hold two active seats. Plaid mints a fresh `item_id`, `account_id`s and
   * `transaction_id`s for every Link flow, so nothing in the schema notices the
   * same real card connected in two households — and one $200 charge then raises
   * $100 against a partner in one household and $100 against roommates in the
   * other, with the linker collecting twice. `assertSplitsBalance` and
   * `verifyLedger` are both scoped to a single household, so both read clean.
   * This warning is the only thing that sees it.
   */
  userId: string;
  plaidItemId: string;
  institutionId: string | null;
  accounts: {
    mask: string | null;
    type: string | null;
    subtype: string | null;
  }[];
}) => {
  const { householdId, userId, plaidItemId, institutionId, accounts } = args;

  // Without an institution to anchor it, "a checking account ending 4242" is a
  // coincidence rather than a duplicate.
  if (!institutionId) return null;

  const matches = accounts.flatMap((account) =>
    account.mask
      ? [
          and(
            eq(BankAccounts.mask, account.mask),
            // `is not distinct from`, because type and subtype are nullable and
            // `= null` matches nothing.
            sql`${BankAccounts.type} is not distinct from ${account.type}::text`,
            sql`${BankAccounts.subtype} is not distinct from ${account.subtype}::text`,
          ),
        ]
      : [],
  );

  if (matches.length === 0) return null;

  const [duplicate] = await db
    // Enough to name it: an id alone leaves the client with a warning it cannot
    // phrase, which is how this ended up computed and then discarded.
    .select({
      id: BankAccounts.id,
      name: BankAccounts.name,
      mask: BankAccounts.mask,
      institutionName: PlaidItems.institutionName,
      householdName: Households.name,
      /**
       * Which of the two warnings to show. A duplicate inside this household
       * doubles up a list; one in another household doubles up a *debt*, and the
       * copy has to say so.
       */
      inAnotherHousehold: ne(BankAccounts.householdId, householdId),
    })
    .from(BankAccounts)
    .innerJoin(PlaidItems, eq(PlaidItems.id, BankAccounts.plaidItemId))
    .innerJoin(Households, eq(Households.id, BankAccounts.householdId))
    .where(
      and(
        // Every household this user actually sits in, not just the active one —
        // and never wider than that, or the warning would disclose that some
        // stranger banks at the same place.
        inArray(
          BankAccounts.householdId,
          db
            .select({ householdId: HouseholdMembers.householdId })
            .from(HouseholdMembers)
            .where(
              and(
                eq(HouseholdMembers.userId, userId),
                eq(HouseholdMembers.status, "active"),
              ),
            ),
        ),
        ne(BankAccounts.plaidItemId, plaidItemId),
        eq(PlaidItems.institutionId, institutionId),
        // An already-muted duplicate is not what the new one would double up
        // with; point the warning at the account still producing rows.
        isNull(BankAccounts.excludedAt),
        or(...matches),
      ),
    )
    // Another household first: that is the one that silently doubles a debt, and
    // it has no in-app remedy the way `excluded_at` is one for a same-household
    // collision. Oldest match within that, so the warning names the original.
    .orderBy(
      desc(sql`${BankAccounts.householdId} <> ${householdId}`),
      BankAccounts.createdAt,
    )
    .limit(1);

  return duplicate ?? null;
};
