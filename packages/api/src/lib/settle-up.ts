import type { Balance } from "./ledger";

export type Transfer = {
  fromMemberId: string;
  toMemberId: string;
  amountCents: number;
};

/**
 * The smallest set of payments that squares everyone up.
 *
 * Pure, and never persisted — recomputed on every request, because the moment a
 * stored suggestion disagrees with the ledger it is worse than no suggestion at
 * all. Greedy largest-debtor-to-largest-creditor, which yields at most
 * `members - 1` transfers: every step zeroes at least one side.
 *
 * Ties break on `memberId` so the same balances always produce the same list.
 * Without that, two members on identical amounts would swap places between
 * requests and the settle-up screen would reshuffle under the user's thumb.
 *
 * Balances that do not sum to zero cannot happen, so nothing here handles the
 * case. If it ever did, the leftover would simply go unmatched.
 */
export const simplify = (balances: readonly Balance[]): Transfer[] => {
  const debtors = balances
    .filter((balance) => balance.netCents < 0)
    .sort(byMagnitude)
    .map((balance) => ({ ...balance }));

  const creditors = balances
    .filter((balance) => balance.netCents > 0)
    .sort(byMagnitude)
    .map((balance) => ({ ...balance }));

  const transfers: Transfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    if (!debtor || !creditor) break;

    const amountCents = Math.min(-debtor.netCents, creditor.netCents);

    transfers.push({
      amountCents,
      fromMemberId: debtor.memberId,
      toMemberId: creditor.memberId,
    });

    debtor.netCents += amountCents;
    creditor.netCents -= amountCents;

    if (debtor.netCents === 0) debtorIndex += 1;
    if (creditor.netCents === 0) creditorIndex += 1;
  }

  return transfers;
};

/** Biggest position first, then by id so the order never moves on its own. */
const byMagnitude = (a: Balance, b: Balance) =>
  Math.abs(b.netCents) - Math.abs(a.netCents) ||
  (a.memberId < b.memberId ? -1 : 1);
