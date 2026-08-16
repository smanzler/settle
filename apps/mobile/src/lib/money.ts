import { formatCurrency } from "@/lib/utils";
import { fromCents } from "@budget/shared";

/** The `numeric(12,2)` ceiling: $9,999,999,999.99. */
const MAX_CENTS = 999_999_999_999;

/**
 * `$213.40` from integer cents.
 *
 * The base-10 conversion is `fromCents`, which is integer arithmetic, so `Intl`
 * only ever sees a value already exact to the cent — this cannot round a
 * balance differently from the ledger that produced it.
 */
export const formatCents = (
  cents: number,
  currency?: string | null,
): string => {
  // `fromCents` throws on a non-integer, and a corrupt payload shouldn't take
  // the screen down with it.
  if (!Number.isSafeInteger(cents)) return "—";

  return formatCurrency(Number(fromCents(cents)), currency);
};

/**
 * `+$12.34` / `−$12.34`, the minus being U+2212 so it sits at digit width.
 *
 * Both directions are signed, unlike a transaction row: a balances list carries
 * money moving both ways and an unsigned figure there is ambiguous.
 */
export const formatSignedCents = (
  cents: number,
  currency?: string | null,
): string => {
  if (cents === 0) return formatCents(0, currency);

  return `${cents < 0 ? "−" : "+"}${formatCents(Math.abs(cents), currency)}`;
};

/**
 * A pair balance as a sentence.
 *
 * `cents` is signed from **your** side, the way `balances.summary` and
 * `balances.activity` both state it: positive means they owe you.
 */
export const formatOwes = ({
  name,
  cents,
  currency,
}: {
  name: string;
  cents: number;
  currency?: string | null;
}): string => {
  if (cents === 0) return "You're settled up";

  return cents > 0
    ? `${name} owes you ${formatCents(cents, currency)}`
    : `You owe ${name} ${formatCents(-cents, currency)}`;
};

/**
 * What was typed into a money field, back to integer cents.
 *
 * Deliberately not the shared `toCents`, which is strict because it parses a
 * `numeric(12,2)` coming out of Postgres: a keypad passes through `""`, `"12."`
 * and `".5"` on the way to a real number, and none of those may throw. `null`
 * means "not a number yet" — callers keep Save disabled on it rather than
 * sending a value the API would only reject.
 *
 * Zero parses successfully. A field that may not be zero (a settlement has to
 * move money) checks that itself, because to a split row a zero share is a
 * perfectly ordinary answer.
 */
export const parseAmountCents = (value: string): number | null => {
  // Currency symbols and thousands separators are stripped rather than
  // rejected, so pasting a field's own formatted output back into it works.
  const cleaned = value.replace(/[^\d.]/g, "");

  // An empty field is a keypad state and reads as zero. A field with something
  // in it but no digit — "abc", or a lone "." — is not a number, and must not
  // quietly read as zero the way stripping alone would leave it.
  if (value.trim() !== "" && !/\d/.test(cleaned)) return null;

  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match) return null;

  const [, whole = "", fraction = ""] = match;
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));

  // A mashed keypad outruns float precision long before it runs out of room in
  // the field, and `fromCents` throws on anything that isn't a safe integer —
  // which would take the screen down mid-render. Nothing above the column's own
  // ceiling can be a real amount anyway.
  return cents > MAX_CENTS ? null : cents;
};
