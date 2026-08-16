import { toCents } from "@budget/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import db from "../../db";
import { BankAccounts, TransactionSplits, Transactions } from "../../db/schema";
import {
  splittableMembers,
  toMemberRef,
  type Member,
  type MemberRef,
} from "../../lib/household";
import { decodeCursor, paginate } from "../../lib/keyset";
import { postShareDeltas, shareTargetFor, type Tx } from "../../lib/ledger";
import {
  assertSplitsBalance,
  ownerOnly,
  partsFromWeights,
  splitsToPairs,
  writeSplits,
  type SplitMethod,
  type SplitPart,
} from "../../lib/splits";
import { householdProcedure, router } from "../../lib/trpc";

/**
 * A private account is visible only to its owner, and an excluded account (a
 * muted duplicate of a joint account someone else already linked) is visible to
 * nobody.
 *
 * Both are applied *inside* the SQL rather than filtered afterwards, so
 * `LIMIT limit + 1` still returns `limit + 1` **matching** rows and the
 * existing `hasMore` logic keeps working untouched.
 */
const visibleToMember = ({
  householdId,
  memberId,
}: {
  householdId: string;
  memberId: string;
}) =>
  and(
    eq(Transactions.householdId, householdId),
    isNull(BankAccounts.excludedAt),
    or(
      eq(Transactions.isPrivate, false),
      eq(Transactions.creditorMemberId, memberId),
    ),
  );

export const transactionsRouter = router({
  list: householdProcedure
    // Deliberately a plain object, not `z.strictObject`: the tanstack-react-query
    // integration injects `direction` into the input on every infinite fetch,
    // and a strict schema would reject it.
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
        accountId: z.uuid().optional(),
      }),
    )
    .query(async (opts) => {
      const { householdId, member } = opts.ctx;
      const { limit, cursor, accountId } = opts.input;

      const keyset = decodeCursor(cursor);

      // The member list depends on neither the page nor the splits, so it rides
      // alongside the page rather than adding a round trip after it.
      const [rows, members] = await Promise.all([
        db
          .select({
            id: Transactions.id,
            amount: Transactions.amount,
            isoCurrencyCode: Transactions.isoCurrencyCode,
            date: Transactions.date,
            name: Transactions.name,
            merchantName: Transactions.merchantName,
            category: Transactions.category,
            categoryDetailed: Transactions.categoryDetailed,
            pending: Transactions.pending,
            logoUrl: Transactions.logoUrl,
            bankAccountId: Transactions.bankAccountId,
            accountName: BankAccounts.name,
            accountMask: BankAccounts.mask,
            creditorMemberId: Transactions.creditorMemberId,
            splitMethod: Transactions.splitMethod,
            splitsStale: Transactions.splitsStale,
          })
          .from(Transactions)
          .innerJoin(
            BankAccounts,
            eq(BankAccounts.id, Transactions.bankAccountId),
          )
          .where(
            and(
              visibleToMember({ householdId, memberId: member.id }),
              accountId ? eq(Transactions.bankAccountId, accountId) : undefined,
              keyset
                ? // Row-wise comparison, so it rides the (household_id, date desc,
                  // id desc) index in a single pass.
                  sql`(${Transactions.date}, ${Transactions.id}) < (${keyset.date}::date, ${keyset.id}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(Transactions.date), desc(Transactions.id))
          .limit(limit + 1),
        splittableMembers(householdId),
      ]);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        date: row.date,
        id: row.id,
      }));

      const attribution = await hydrateAttribution({
        householdId,
        members,
        transactions: items,
        youId: member.id,
      });

      return {
        items: items.map((row) => ({
          ...row,
          ...(attribution.get(row.id) ?? { yourShare: null, participants: [] }),
        })),
        nextCursor,
      };
    }),

  get: householdProcedure
    .input(z.object({ transactionId: z.uuid() }))
    .query(async (opts) => {
      const { householdId, member } = opts.ctx;

      const [row] = await db
        .select({
          id: Transactions.id,
          amount: Transactions.amount,
          isoCurrencyCode: Transactions.isoCurrencyCode,
          date: Transactions.date,
          name: Transactions.name,
          merchantName: Transactions.merchantName,
          category: Transactions.category,
          pending: Transactions.pending,
          logoUrl: Transactions.logoUrl,
          creditorMemberId: Transactions.creditorMemberId,
          splitMethod: Transactions.splitMethod,
          splitsStale: Transactions.splitsStale,
          accountId: BankAccounts.id,
          accountName: BankAccounts.name,
          accountMask: BankAccounts.mask,
        })
        .from(Transactions)
        .innerJoin(
          BankAccounts,
          eq(BankAccounts.id, Transactions.bankAccountId),
        )
        .where(
          and(
            eq(Transactions.id, opts.input.transactionId),
            visibleToMember({ householdId, memberId: member.id }),
          ),
        );

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Transaction not found",
        });
      }

      const [splits, members] = await Promise.all([
        db
          .select({
            memberId: TransactionSplits.memberId,
            weight: TransactionSplits.weight,
            amountCents: TransactionSplits.amountCents,
          })
          .from(TransactionSplits)
          .where(eq(TransactionSplits.transactionId, row.id)),
        splittableMembers(householdId),
      ]);

      const byId = new Map(members.map((m) => [m.id, m]));

      return {
        transaction: row,
        currency: row.isoCurrencyCode,
        splits: splits.map((split) => ({
          member: toMemberRef({
            fallbackId: split.memberId,
            member: byId.get(split.memberId),
            youId: member.id,
          }),
          weight: split.weight,
          amountCents: split.amountCents,
        })),
        // Everyone who *could* be given a share, so the editor can offer them.
        members: members.map((seat) =>
          toMemberRef({ fallbackId: seat.id, member: seat, youId: member.id }),
        ),
      };
    }),

  /**
   * Replace a transaction's split.
   *
   * `shares` sends weights and the **server** runs the allocator — the client
   * never rounds, so it cannot disagree with what gets stored. `exact` sends
   * cents and is rejected unless they sum to the amount exactly; the client
   * mirrors the same invariant with the shared `allocate`, so this is a
   * backstop rather than the primary feedback path.
   */
  setSplit: householdProcedure
    .input(
      z.union([
        z.object({
          transactionId: z.uuid(),
          method: z.literal("shares"),
          parts: z
            .array(
              z.object({
                memberId: z.uuid(),
                weight: z.int().min(1).max(1000),
              }),
            )
            .min(1),
        }),
        z.object({
          transactionId: z.uuid(),
          method: z.literal("exact"),
          parts: z
            .array(
              z.object({
                memberId: z.uuid(),
                /** A magnitude — the server applies the transaction's sign. */
                amountCents: z.int().min(0),
              }),
            )
            .min(1),
        }),
      ]),
    )
    .mutation(async (opts) => {
      const { householdId, member } = opts.ctx;
      const { input } = opts;

      // The member list doesn't depend on the transaction, so the two reads go
      // out together — this is the most latency-visible tap in the feature.
      const [transaction, members] = await Promise.all([
        loadEditable({
          householdId,
          memberId: member.id,
          transactionId: input.transactionId,
        }),
        splittableMembers(householdId),
      ]);
      const totalCents = toCents(transaction.amount);

      // `splittableMembers` is already exactly the active-and-invited set.
      const allowed = new Set(members.map((m) => m.id));

      for (const part of input.parts) {
        if (!allowed.has(part.memberId)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That person is not a member of this household",
          });
        }
      }

      if (
        new Set(input.parts.map((p) => p.memberId)).size !== input.parts.length
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A member can only appear once in a split",
        });
      }

      let parts: SplitPart[];

      if (input.method === "shares") {
        parts = partsFromWeights(totalCents, input.parts);
      } else {
        // Magnitudes in, signed cents out: the split of a refund is the split
        // of the purchase with every share negated, and asking the client to
        // reason about Plaid's sign convention is how the two ends drift apart.
        const sign = totalCents < 0 ? -1 : 1;
        const supplied = input.parts.reduce(
          (sum, part) => sum + part.amountCents,
          0,
        );

        if (supplied !== Math.abs(totalCents)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Shares must add up to the transaction amount — off by ${
              Math.abs(totalCents) - supplied
            } cents`,
          });
        }

        parts = input.parts.map((part) => ({
          memberId: part.memberId,
          weight: 1,
          amountCents: part.amountCents === 0 ? 0 : sign * part.amountCents,
        }));
      }

      // The payer is deliberately NOT forced into the split.
      //
      // A row used to be fabricated for them at `weight: 1, amountCents: 0` so
      // the editor always had one to render. But `weight` is what
      // `reallocateForAmountChange` re-runs the allocator over, so that
      // placeholder read as "an equal share" the next time Plaid moved the
      // amount, and silently handed the excluded payer a third of the bill.
      // There is no legal way to write "present but claiming nothing" — the
      // `weight > 0` CHECK forbids a zero — so presence is the participation
      // flag instead, and "I paid, you two split it" is expressed by simply
      // leaving them out. `hydrateAttribution` re-adds them for display.
      assertSplitsBalance({
        amount: transaction.amount,
        context: "setSplit",
        parts,
      });

      await db.transaction((tx) =>
        applySplit(tx, {
          householdId,
          actorMemberId: member.id,
          transaction,
          method: input.method,
          parts,
        }),
      );

      return { transactionId: transaction.id, parts };
    }),

  /** Back to the whole amount on the payer — the "Just me" shortcut. */
  resetSplit: householdProcedure
    .input(z.object({ transactionId: z.uuid() }))
    .mutation(async (opts) => {
      const { householdId, member } = opts.ctx;

      const transaction = await loadEditable({
        householdId,
        memberId: member.id,
        transactionId: opts.input.transactionId,
      });
      const { parts } = ownerOnly(
        transaction.creditorMemberId,
        toCents(transaction.amount),
      );

      // The payer's own share produces no pair, so this posts an empty target —
      // which drains every pair already posted for this ref to exactly zero,
      // and that is what "nobody owes anything for this" means.
      await db.transaction((tx) =>
        applySplit(tx, {
          householdId,
          actorMemberId: member.id,
          transaction,
          method: "owner",
          parts,
        }),
      );

      return { transactionId: transaction.id };
    }),
});

/**
 * The whole write behind a split: the rows, the stamp on the transaction, and
 * the ledger deltas that follow from them.
 *
 * `setSplit` and `resetSplit` differ only in the parts they compute and the
 * method they record. Keeping the three statements — and the order they run in
 * — in one place is what stops the two paths from drifting, and gives the next
 * writer of a split something to call rather than a sequence to reconstruct.
 */
const applySplit = async (
  tx: Tx,
  args: {
    householdId: string;
    actorMemberId: string;
    transaction: Awaited<ReturnType<typeof loadEditable>>;
    method: SplitMethod;
    parts: SplitPart[];
  },
) => {
  const { householdId, actorMemberId, transaction, method, parts } = args;

  await writeSplits(tx, {
    householdId,
    transactionId: transaction.id,
    parts,
  });

  await tx
    .update(Transactions)
    .set({
      splitMethod: method,
      // The human has just resolved whatever Plaid changed.
      splitsStale: false,
      splitUpdatedAt: new Date(),
      splitUpdatedByMemberId: actorMemberId,
    })
    .where(
      and(
        eq(Transactions.id, transaction.id),
        eq(Transactions.householdId, householdId),
      ),
    );

  await postShareDeltas(tx, {
    householdId,
    actorMemberId,
    targets: [
      shareTargetFor(
        transaction,
        transaction.currency,
        splitsToPairs(transaction.creditorMemberId, parts),
      ),
    ],
  });
};

/**
 * Loads a transaction for editing, refusing the cases where a split would be
 * meaningless or wrong.
 */
const loadEditable = async ({
  householdId,
  memberId,
  transactionId,
}: {
  householdId: string;
  memberId: string;
  transactionId: string;
}) => {
  const [row] = await db
    .select({
      id: Transactions.id,
      plaidTransactionId: Transactions.plaidTransactionId,
      amount: Transactions.amount,
      date: Transactions.date,
      name: Transactions.name,
      merchantName: Transactions.merchantName,
      isoCurrencyCode: Transactions.isoCurrencyCode,
      creditorMemberId: Transactions.creditorMemberId,
      excludedAt: BankAccounts.excludedAt,
      currency: sql<string>`(select default_currency from households where id = ${householdId})`,
      /**
       * Has a debt raised by this transaction already been paid off?
       *
       * The enforceable half of "a settled transaction can't change". Plaid
       * cannot be refused — the sync upsert writes a new amount before any split
       * code runs — but a *person* re-splitting a purchase somebody has already
       * settled can be, and that is the case worth stopping: it moves cents onto
       * a pair that has closed, so the payer either loses money they were paid or
       * is owed money nobody knows about.
       *
       * Two details this shape exists for:
       *
       * Pairs, not the creditor. A four-person household where the payer settled
       * with one housemate must stay editable with respect to the other two, so
       * the settlement has to match the debtor on the *share entry* rather than
       * merely involve the payer.
       *
       * `created_at`, not `settled_on` or `date`. A new account backfills two
       * years (DAYS_REQUESTED is 730), so a transaction dated before the last
       * settlement routinely arrives after it — comparing effective dates would
       * have those rows born un-editable. What actually matters is whether the
       * debt was on the balance when somebody chose to settle it, which is when
       * the share was posted versus when the payment was recorded.
       */
      settledPair: sql<boolean>`exists (
        select 1
        from settlements s
        join ledger_entries e
          on e.household_id = s.household_id
         and e.kind = 'share'
         and e.external_ref = 'plaid:' || ${Transactions.plaidTransactionId}
        where s.household_id = ${householdId}
          and s.voided_at is null
          and s.created_at > e.created_at
          and (
            (s.from_member_id = e.debtor_member_id and s.to_member_id = e.creditor_member_id)
            or (s.from_member_id = e.creditor_member_id and s.to_member_id = e.debtor_member_id)
          )
      )`,
    })
    .from(Transactions)
    .innerJoin(BankAccounts, eq(BankAccounts.id, Transactions.bankAccountId))
    .where(
      and(
        eq(Transactions.id, transactionId),
        // The same predicate the reads use, privacy included. Without it a
        // member who cannot see a private account's rows could still split
        // one — and read its exact amount back out of the "off by N cents"
        // refusal. The excluded-account case is refused below instead, because
        // that one has an explanation worth giving.
        or(
          eq(Transactions.isPrivate, false),
          eq(Transactions.creditorMemberId, memberId),
        ),
        eq(Transactions.householdId, householdId),
      ),
    );

  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Transaction not found",
    });
  }

  if (row.excludedAt !== null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "This account is hidden as a duplicate",
    });
  }

  // Entries carry a single currency and balances group by it; a split across
  // two currencies would need a rate, and a wrong rate is worse than a refusal.
  if (row.isoCurrencyCode !== null && row.isoCurrencyCode !== row.currency) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Only ${row.currency} transactions can be split`,
    });
  }

  // Last, and after the cheap refusals: a settled split is a closed deal, not a
  // permissions problem. Voiding the payment reopens it, which is why the
  // sentence says so rather than reading as a dead end.
  if (row.settledPair) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This purchase is part of a balance somebody has already paid off, so its split is fixed. Void that payment first if it needs to change.",
    });
  }

  return row;
};

/**
 * Stitches attribution onto a page of transactions with one extra query.
 *
 * Skipped entirely for a household of one: a solo user gets byte-identical
 * behaviour to before this feature existed, and zero extra round trips.
 */
const hydrateAttribution = async ({
  householdId,
  members,
  transactions,
  youId,
}: {
  householdId: string;
  members: readonly Member[];
  transactions: readonly { id: string; creditorMemberId: string }[];
  youId: string;
}) => {
  const byTransaction = new Map<
    string,
    { yourShare: number | null; participants: MemberRef[] }
  >();

  if (transactions.length === 0) return byTransaction;
  if (members.length <= 1) return byTransaction;

  const byId = new Map(members.map((m) => [m.id, m]));

  const splits = await db
    .select({
      transactionId: TransactionSplits.transactionId,
      memberId: TransactionSplits.memberId,
      amountCents: TransactionSplits.amountCents,
    })
    .from(TransactionSplits)
    .where(
      and(
        eq(TransactionSplits.householdId, householdId),
        inArray(
          TransactionSplits.transactionId,
          transactions.map((transaction) => transaction.id),
        ),
      ),
    );

  for (const split of splits) {
    const entry = byTransaction.get(split.transactionId) ?? {
      yourShare: null,
      participants: [],
    };

    entry.participants.push(
      toMemberRef({
        fallbackId: split.memberId,
        member: byId.get(split.memberId),
        youId,
      }),
    );

    if (split.memberId === youId) entry.yourShare = split.amountCents;

    byTransaction.set(split.transactionId, entry);
  }

  // The payer is a participant of everything they paid for, whether or not
  // they took a share of it — but a split that omits them is exactly how "I
  // paid, you two split it" is stored, so they are not in the rows. Adding
  // them back here is what keeps the avatar stack and the "you $0.00" subtitle
  // on a bill somebody else ate, without a fabricated weight in the database.
  for (const transaction of transactions) {
    const entry = byTransaction.get(transaction.id);
    if (!entry) continue;

    const { creditorMemberId } = transaction;
    if (entry.participants.some((seat) => seat.id === creditorMemberId)) {
      continue;
    }

    entry.participants.push(
      toMemberRef({
        fallbackId: creditorMemberId,
        member: byId.get(creditorMemberId),
        youId,
      }),
    );

    if (creditorMemberId === youId) entry.yourShare = 0;
  }

  // A split that is entirely yours is not attribution — the client renders
  // nothing, which is what keeps a shared household's list quiet.
  for (const [transactionId, entry] of byTransaction) {
    if (entry.participants.length <= 1) {
      byTransaction.set(transactionId, { yourShare: null, participants: [] });
    }
  }

  return byTransaction;
};
