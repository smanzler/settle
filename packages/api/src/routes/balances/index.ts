import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import db from "../../db";
import { HouseholdMembers, LedgerEntries, Transactions } from "../../db/schema";
import { toMemberRef } from "../../lib/household";
import { decodeCursor, paginate } from "../../lib/keyset";
import { verifyLedger } from "../../lib/ledger";
import { householdProcedure, ownerProcedure, router } from "../../lib/trpc";

/**
 * A pairwise net, normalized so the pair `(a, b)` and `(b, a)` are one row.
 *
 * Restricted to pairs `memberId` is part of: the caller is shown only their own
 * balances, so aggregating the whole household would compute and discard every
 * other pair — and the predicate lets this ride the debtor/creditor indexes
 * instead of scanning the household's entire history.
 *
 * Currency is in the GROUP BY because it costs one line and removes any chance
 * of adding EUR cents to USD cents. `sum(bigint)` returns `numeric`, which
 * node-postgres hands back as a **string** — every consumer below Number()s it
 * explicitly rather than letting `a + b` concatenate.
 */
const pairBalances = ({
  householdId,
  memberId,
}: {
  householdId: string;
  memberId: string;
}) =>
  db.execute<{
    member_a: string;
    member_b: string;
    iso_currency_code: string;
    a_owes_b_cents: string;
  }>(sql`
    select least(${LedgerEntries.debtorMemberId}, ${LedgerEntries.creditorMemberId})    as member_a,
           greatest(${LedgerEntries.debtorMemberId}, ${LedgerEntries.creditorMemberId}) as member_b,
           ${LedgerEntries.isoCurrencyCode}                                             as iso_currency_code,
           sum(case when ${LedgerEntries.debtorMemberId} < ${LedgerEntries.creditorMemberId}
                    then ${LedgerEntries.amountCents}
                    else -${LedgerEntries.amountCents} end)::text                       as a_owes_b_cents
    from ${LedgerEntries}
    where ${LedgerEntries.householdId} = ${householdId}
      and (${LedgerEntries.debtorMemberId} = ${memberId}
        or ${LedgerEntries.creditorMemberId} = ${memberId})
    group by 1, 2, 3
    having sum(case when ${LedgerEntries.debtorMemberId} < ${LedgerEntries.creditorMemberId}
                    then ${LedgerEntries.amountCents}
                    else -${LedgerEntries.amountCents} end) <> 0
  `);

export const balancesRouter = router({
  /**
   * Who owes whom, derived on read.
   *
   * Nothing is materialized: a household is a handful of people over a few
   * thousand transactions, so this is a sub-millisecond aggregate that cannot
   * drift from the entries it summarizes.
   */
  summary: householdProcedure.query(async (opts) => {
    const { householdId, member } = opts.ctx;

    const [{ rows }, members, household, pending] = await Promise.all([
      pairBalances({ householdId, memberId: member.id }),
      db
        .select({
          id: HouseholdMembers.id,
          displayName: HouseholdMembers.displayName,
          status: HouseholdMembers.status,
        })
        .from(HouseholdMembers)
        .where(eq(HouseholdMembers.householdId, householdId))
        .orderBy(HouseholdMembers.createdAt),
      db.query.Households.findFirst({
        where: { id: householdId },
        columns: { defaultCurrency: true },
      }),
      pendingExposure({ householdId, memberId: member.id }),
    ]);

    const byId = new Map(members.map((m) => [m.id, m]));

    const pairs = rows.map((row) => {
      const cents = Number(row.a_owes_b_cents);
      const youAreA = row.member_a === member.id;
      const otherId = youAreA ? row.member_b : row.member_a;

      return {
        // A pair always has you on exactly one side and `CHECK (debtor <>
        // creditor)` keeps the sides distinct, so `otherId` is never you and
        // this always shapes to `isYou: false`.
        member: toMemberRef({
          fallbackId: otherId,
          member: byId.get(otherId),
          youId: member.id,
        }),
        // Positive means they owe you. `a_owes_b` is stated from a's side, so
        // it flips when you are a.
        cents: youAreA ? -cents : cents,
        currency: row.iso_currency_code,
      };
    });

    // Two figures, never netted into one: netting hides who to chase.
    const owedToYou = totalsByCurrency(pairs.filter((pair) => pair.cents > 0));
    const youOwe = totalsByCurrency(
      pairs
        .filter((pair) => pair.cents < 0)
        .map((pair) => ({ ...pair, cents: -pair.cents })),
    );

    return {
      currency: household?.defaultCurrency ?? "USD",
      you: { owedToYou, youOwe },
      pairs: pairs.toSorted((a, b) => Math.abs(b.cents) - Math.abs(a.cents)),
      /**
       * Pending charges are posted to the ledger immediately, because seeing a
       * shared dinner an hour later beats seeing it in three days. The trade is
       * that a pending amount still moves (tips), so the client captions the
       * hero with how much of the balance is not yet settled at the bank.
       */
      pending,
    };
  }),

  /**
   * The audit view — why you owe what you owe.
   *
   * Rendering the entries directly is what makes the balance believable: every
   * number traces to a purchase between exactly these two people.
   */
  activity: householdProcedure
    .input(
      z.object({
        memberId: z.uuid(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async (opts) => {
      const { householdId, member } = opts.ctx;
      const { memberId, limit, cursor } = opts.input;

      const keyset = decodeCursor(cursor);

      const rows = await db
        .select({
          id: LedgerEntries.id,
          kind: LedgerEntries.kind,
          amountCents: LedgerEntries.amountCents,
          isoCurrencyCode: LedgerEntries.isoCurrencyCode,
          effectiveDate: LedgerEntries.effectiveDate,
          memo: LedgerEntries.memo,
          transactionId: LedgerEntries.transactionId,
          debtorMemberId: LedgerEntries.debtorMemberId,
        })
        .from(LedgerEntries)
        .where(
          and(
            eq(LedgerEntries.householdId, householdId),
            // Exactly this pair, from either side.
            or(
              and(
                eq(LedgerEntries.debtorMemberId, member.id),
                eq(LedgerEntries.creditorMemberId, memberId),
              ),
              and(
                eq(LedgerEntries.debtorMemberId, memberId),
                eq(LedgerEntries.creditorMemberId, member.id),
              ),
            ),
            keyset
              ? sql`(${LedgerEntries.effectiveDate}, ${LedgerEntries.id}) < (${keyset.date}::date, ${keyset.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(
          sql`${LedgerEntries.effectiveDate} desc, ${LedgerEntries.id} desc`,
        )
        .limit(limit + 1);

      const { items, nextCursor } = paginate(rows, limit, (row) => ({
        date: row.effectiveDate,
        id: row.id,
      }));

      return {
        items: items.map((row) => ({
          id: row.id,
          kind: row.kind,
          // Restated from your side so the client never has to know which of
          // the two members sits in `debtor_member_id`.
          cents:
            row.debtorMemberId === member.id
              ? -row.amountCents
              : row.amountCents,
          currency: row.isoCurrencyCode,
          effectiveDate: row.effectiveDate,
          memo: row.memo,
          /** Null once Plaid removed the row, or the item was purged. */
          transactionId: row.transactionId,
          direction:
            row.debtorMemberId === member.id
              ? ("you_owe_them" as const)
              : ("they_owe_you" as const),
        })),
        nextCursor,
      };
    }),

  /**
   * Recomputes the target from the splits and reports any ref the entries
   * disagree with. Read-only; exposed so a drift is detectable rather than
   * silent.
   *
   * Owner-only by refusal, not by an empty answer: this is a diagnostic whose
   * whole meaning is "empty means clean", so handing a non-owner `refs: []`
   * tells them the ledger is sound when nobody has checked.
   */
  verify: ownerProcedure.query(async (opts) => ({
    refs: await verifyLedger(opts.ctx.householdId),
  })),
});

const totalsByCurrency = (
  pairs: readonly { cents: number; currency: string }[],
) => {
  const totals = new Map<string, number>();

  for (const pair of pairs) {
    totals.set(pair.currency, (totals.get(pair.currency) ?? 0) + pair.cents);
  }

  return [...totals].map(([currency, cents]) => ({ cents, currency }));
};

/** How much of your balance still rides on charges the bank hasn't posted. */
const pendingExposure = async ({
  householdId,
  memberId,
}: {
  householdId: string;
  memberId: string;
}) => {
  const rows = await db
    .select({
      currency: LedgerEntries.isoCurrencyCode,
      cents: sql<string>`sum(case when ${LedgerEntries.debtorMemberId} = ${memberId}
                                  then -${LedgerEntries.amountCents}
                                  else ${LedgerEntries.amountCents} end)::text`,
    })
    .from(LedgerEntries)
    .innerJoin(Transactions, eq(Transactions.id, LedgerEntries.transactionId))
    .where(
      and(
        eq(LedgerEntries.householdId, householdId),
        eq(Transactions.pending, true),
        or(
          eq(LedgerEntries.debtorMemberId, memberId),
          eq(LedgerEntries.creditorMemberId, memberId),
        ),
      ),
    )
    .groupBy(LedgerEntries.isoCurrencyCode);

  return rows
    .map((row) => ({ cents: Number(row.cents), currency: row.currency }))
    .filter((row) => row.cents !== 0);
};
