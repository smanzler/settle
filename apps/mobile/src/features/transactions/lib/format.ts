import { formatCurrency } from "@/lib/utils";
import { fromCents } from "@budget/shared";

export type FormattedAmount = {
  text: string;
  /** Money came *in* — a refund, payment, or deposit. */
  isInflow: boolean;
};

/**
 * The only module allowed to interpret Plaid's sign convention.
 *
 * Rows are stored verbatim from Plaid, where a **positive** amount means money
 * **left** the account. Everywhere else in the app, ask this function.
 *
 * Outflows render bare (`$12.34`) because a card ledger is ~95% debits and
 * signing all of them is noise; inflows get an explicit `+` and, at the call
 * site, the one bit of color on the row.
 */
export const formatTransactionAmount = ({
  amount,
  currency,
}: {
  amount: string;
  currency?: string | null;
}): FormattedAmount => {
  // `Number("")` is 0, so an empty string would silently render as $0.00.
  const value = amount.trim() === "" ? NaN : Number(amount);

  if (!Number.isFinite(value)) return { text: "—", isInflow: false };

  const isInflow = value < 0;

  return {
    text: `${isInflow ? "+" : ""}${formatCurrency(Math.abs(value), currency)}`,
    isInflow,
  };
};

export type Attribution = {
  /** Your slice, already formatted — `you $25.00`. */
  yourShareText: string;
  /** Everyone on the split, you first, for the avatar stack. */
  participants: { id: string; displayName: string; isYou: boolean }[];
};

/**
 * How a transaction's split renders on a row, or `null` when there is nothing
 * to say.
 *
 * Returning `null` for a split that is entirely yours is what keeps a
 * single-member household — and every unshared purchase in a shared one —
 * looking exactly as it did before this feature existed. The server already
 * withholds attribution for solo households; this is the same rule applied to
 * the individual row.
 */
export const formatAttribution = (transaction: {
  yourShare: number | null;
  participants: { id: string; displayName: string; isYou: boolean }[];
  isoCurrencyCode?: string | null;
}): Attribution | null => {
  if (transaction.participants.length <= 1) return null;
  if (transaction.yourShare === null) return null;

  const { text } = formatTransactionAmount({
    // `fromCents` rather than a float divide: the shared money module exists so
    // one rounding implementation serves the client and the server, and a share
    // is exactly the number that must not disagree with the ledger.
    amount: fromCents(transaction.yourShare),
    currency: transaction.isoCurrencyCode,
  });

  return {
    yourShareText: `you ${text}`,
    participants: [...transaction.participants].sort(
      (a, b) => Number(b.isYou) - Number(a.isYou),
    ),
  };
};

/** `SM` — the two-letter stand-in when a member has no avatar image. */
export const formatMemberInitials = (displayName: string): string => {
  const [first, second] = displayName.trim().split(/\s+/).filter(Boolean);
  if (!first) return "?";

  // `charAt` returns "" rather than undefined past the end, so a one-word,
  // one-letter name simply yields a single initial.
  return (
    first.charAt(0) + (second?.charAt(0) ?? first.charAt(1))
  ).toUpperCase();
};

/** `Chase Sapphire •••• 4242` — the subtitle for an account row. */
export const formatAccountLabel = ({
  name,
  mask,
}: {
  name: string;
  mask?: string | null;
}): string => (mask ? `${name} •••• ${mask}` : name);

/** `FOOD_AND_DRINK` → `Food and drink`. */
export const formatCategory = (category?: string | null): string | null => {
  if (!category) return null;

  const words = category.toLowerCase().split("_");
  const [first, ...rest] = words;
  if (!first) return null;

  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
};
