/**
 * `4000` → `"40.00"`.
 *
 * Base-ten string assembly by integer arithmetic, never `cents / 100`. Money is
 * integer cents everywhere in this app, and this is the one place a rendered
 * figure could come to disagree with the ledger that produced it.
 */
export const fromCents = (cents: number): string => {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`not an integer cent amount: ${cents}`);
  }

  const magnitude = Math.abs(cents);

  return `${cents < 0 ? "-" : ""}${Math.trunc(magnitude / 100)}.${String(
    magnitude % 100,
  ).padStart(2, "0")}`;
};
