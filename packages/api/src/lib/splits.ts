import {
  allocate,
  equalParts,
  toCents,
  type AllocationPart,
} from "@budget/shared";
import { and, eq, notInArray } from "drizzle-orm";
import { TransactionSplits } from "../db/schema";
import type { SharePair, Tx } from "./ledger";
import { sqlExcluded } from "./sql";

export type SplitMethod = "owner" | "shares" | "exact";

export type SplitPart = {
  memberId: string;
  weight: number;
  amountCents: number;
};

/**
 * Categories that must never be split automatically.
 *
 * A paycheck is not a shared expense; a transfer between your own accounts is
 * not spending; and a credit-card payment is the *cancellation* of charges that
 * were already split, so splitting it too would silently zero out the month's
 * debt. A human can still split any of these by hand — this gate only governs
 * what happens before anyone looks.
 */
const NEVER_SPLIT_PRIMARY = new Set(["INCOME", "TRANSFER_IN", "TRANSFER_OUT"]);
const NEVER_SPLIT_DETAILED = new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]);

export const isNeverSplit = (transaction: {
  category: string | null;
  categoryDetailed: string | null;
}) =>
  (transaction.category !== null &&
    NEVER_SPLIT_PRIMARY.has(transaction.category)) ||
  (transaction.categoryDetailed !== null &&
    NEVER_SPLIT_DETAILED.has(transaction.categoryDetailed));

/** The whole amount on the payer. Produces no ledger entries at all. */
export const ownerOnly = (
  creditorMemberId: string,
  totalCents: number,
): { method: SplitMethod; parts: SplitPart[] } => ({
  method: "owner",
  parts: [{ memberId: creditorMemberId, weight: 1, amountCents: totalCents }],
});

/**
 * How a transaction is split the moment `plaid-sync` inserts it, before any
 * human touches it.
 *
 * Owner-100% unless the account is explicitly set to split equally *and* the
 * transaction is dated on or after the day that setting was turned on. That
 * date check is what stops "share the joint Amex" from inventing two years of
 * retroactive debt.
 */
export const resolveDefaultSplit = (args: {
  creditorMemberId: string;
  totalCents: number;
  transaction: {
    date: string;
    category: string | null;
    categoryDetailed: string | null;
    isoCurrencyCode: string | null;
  };
  account: {
    defaultSplit: "owner" | "equal";
    /** `YYYY-MM-DD`, so a lexicographic compare is a date compare. */
    defaultSplitFrom: string | null;
    isPrivate: boolean;
    excludedAt: Date | null;
  };
  /**
   * The household's own currency. A transaction in any other one is left whole
   * on the payer, matching what `transactions.setSplit` already refuses by hand:
   * ledger entries carry a single currency and balances group by it, so an
   * auto-split here would raise debt in a currency `settlements.create` — which
   * always posts in the household currency — could never pay off.
   */
  householdCurrency: string;
  /** Members who may be assigned a share — active and invited seats. */
  memberIds: string[];
}): { method: SplitMethod; parts: SplitPart[] } => {
  const { creditorMemberId, totalCents, transaction, account } = args;

  const splitsEqually =
    account.defaultSplit === "equal" &&
    !account.isPrivate &&
    account.excludedAt === null &&
    !isNeverSplit(transaction) &&
    (transaction.isoCurrencyCode === null ||
      transaction.isoCurrencyCode === args.householdCurrency) &&
    (account.defaultSplitFrom === null ||
      transaction.date >= account.defaultSplitFrom);

  if (!splitsEqually) return ownerOnly(creditorMemberId, totalCents);

  // The creditor is always a participant, even if they somehow fell out of the
  // member list — a split that excluded the payer would owe them the whole
  // amount twice.
  const memberIds = args.memberIds.includes(creditorMemberId)
    ? args.memberIds
    : [creditorMemberId, ...args.memberIds];

  if (memberIds.length <= 1) return ownerOnly(creditorMemberId, totalCents);

  return {
    method: "shares",
    parts: partsFromWeights(totalCents, equalParts(memberIds)),
  };
};

/** Runs the shared allocator and pairs the cents back up with their weights. */
export const partsFromWeights = (
  totalCents: number,
  weights: readonly AllocationPart[],
): SplitPart[] => {
  const allocated = allocate(totalCents, weights);

  return weights.map((part) => ({
    memberId: part.memberId,
    weight: part.weight,
    amountCents: allocated.get(part.memberId) ?? 0,
  }));
};

export const sumCents = (parts: readonly SplitPart[]) =>
  parts.reduce((total, part) => total + part.amountCents, 0);

/**
 * The invariant, checked after every allocation including the sync path's.
 *
 * Cheap, and the only thing standing between a rounding bug and a balance
 * nobody can reproduce.
 */
export const assertSplitsBalance = ({
  amount,
  context,
  parts,
}: {
  amount: string;
  context: string;
  parts: readonly SplitPart[];
}) => {
  const total = toCents(amount);
  const allocated = sumCents(parts);

  if (allocated !== total) {
    throw new Error(
      `split partition broken (${context}): parts sum to ${allocated}, amount is ${total}`,
    );
  }
};

/**
 * Recompute an existing split against a new amount from Plaid.
 *
 * `owner` and `shares` re-run the allocator over the stored weights, because
 * the weights *are* the user's intent and survive an amount change intact.
 *
 * `exact` cannot: those are numbers a human typed, and rescaling them would
 * silently invent a split nobody chose. The payer absorbs the variance instead
 * and the row is flagged for review — unless absorbing would produce nonsense,
 * in which case the split resets rather than posting a number that is wrong.
 */
export const reallocateForAmountChange = (args: {
  method: SplitMethod;
  creditorMemberId: string;
  existing: readonly SplitPart[];
  newCents: number;
}): { method: SplitMethod; parts: SplitPart[]; splitsStale: boolean } => {
  const { method, creditorMemberId, existing, newCents } = args;

  if (existing.length === 0) {
    return { ...ownerOnly(creditorMemberId, newCents), splitsStale: false };
  }

  switch (method) {
    case "owner":
    case "shares":
      return {
        method,
        parts: partsFromWeights(newCents, existing),
        splitsStale: false,
      };
    case "exact": {
      const oldTotal = sumCents(existing);

      // A split may legitimately omit the payer — "I paid, the two of you split
      // it" — so there may be no row to absorb onto. Absorbing onto a notional
      // zero and letting it join the split is what keeps that case from
      // resetting to owner-only on the first amount change.
      const creditor = existing.find(
        (part) => part.memberId === creditorMemberId,
      ) ?? { memberId: creditorMemberId, weight: 1, amountCents: 0 };

      // A sign flip is a different transaction in all but name — a charge that
      // became a refund. Nothing about the old hand-typed amounts still applies.
      if (Math.sign(newCents) === Math.sign(oldTotal)) {
        const absorbed = creditor.amountCents + (newCents - oldTotal);

        // Without these two guards, a $100 exact split of $10 payer / $90 other
        // that drops to $40 leaves the payer at -$50 — i.e. owed $90 on a $40
        // dinner. Absorbing blindly invents money.
        const flipsPayer =
          absorbed !== 0 && Math.sign(absorbed) !== Math.sign(newCents);
        const exceedsTotal = Math.abs(absorbed) > Math.abs(newCents);

        if (!flipsPayer && !exceedsTotal) {
          const isParticipant = existing.some(
            (part) => part.memberId === creditorMemberId,
          );

          return {
            method: "exact",
            parts: isParticipant
              ? existing.map((part) =>
                  part.memberId === creditorMemberId
                    ? { ...part, amountCents: absorbed }
                    : part,
                )
              : // Still nothing to their name, so they stay out of the split
                // rather than gaining a zero-cent row nobody asked for.
                absorbed === 0
                ? [...existing]
                : [...existing, { ...creditor, amountCents: absorbed }],
            splitsStale: true,
          };
        }
      }

      return { ...ownerOnly(creditorMemberId, newCents), splitsStale: true };
    }
  }
};

/**
 * The splits, as debts.
 *
 * The creditor's own share produces no entry — a `CHECK (debtor <> creditor)`
 * makes that structural — and zero-cent shares are dropped because they are not
 * debts.
 */
export const splitsToPairs = (
  creditorMemberId: string,
  parts: readonly SplitPart[],
): SharePair[] =>
  parts
    .filter(
      (part) => part.memberId !== creditorMemberId && part.amountCents !== 0,
    )
    .map((part) => ({
      debtorMemberId: part.memberId,
      creditorMemberId,
      cents: part.amountCents,
    }));

/** Upserts the split rows and drops any member no longer participating. */
export const writeSplits = async (
  tx: Tx,
  args: {
    householdId: string;
    transactionId: string;
    parts: SplitPart[];
    /**
     * Set when the transaction row was created by this same sync statement. A
     * row that did not exist a moment ago cannot have splits pointing at it, so
     * the cleanup DELETE is provably a no-op — and skipping it removes a third
     * of the statements from a first sync's per-transaction write loop.
     */
    isNewTransaction?: boolean;
  },
) => {
  const { householdId, transactionId, parts } = args;

  if (parts.length === 0) {
    throw new Error(`refusing to leave ${transactionId} with no splits`);
  }

  await tx
    .insert(TransactionSplits)
    .values(
      parts.map((part) => ({
        householdId,
        transactionId,
        memberId: part.memberId,
        weight: part.weight,
        amountCents: part.amountCents,
      })),
    )
    .onConflictDoUpdate({
      target: [TransactionSplits.transactionId, TransactionSplits.memberId],
      set: {
        weight: sqlExcluded("weight"),
        amountCents: sqlExcluded("amount_cents"),
        updatedAt: new Date(),
      },
    });

  if (args.isNewTransaction) return;

  await tx.delete(TransactionSplits).where(
    and(
      eq(TransactionSplits.transactionId, transactionId),
      notInArray(
        TransactionSplits.memberId,
        parts.map((part) => part.memberId),
      ),
    ),
  );
};
