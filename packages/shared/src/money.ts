/**
 * Integer-cent money, shared by the API and the clients.
 *
 * Lives in `shared` rather than `api` on purpose: the split editor previews the
 * exact cents the server will store, so the preview and the optimistic cache
 * update are byte-identical to the write. A second, subtly different rounding
 * implementation on the client is how a UI ends up disagreeing with its own
 * database.
 */

/** A member's slice of a transaction, expressed as a weight rather than cents. */
export type AllocationPart = {
  memberId: string;
  /**
   * Relative share. Equal split = all 1s; percentages = weights out of 100.
   * Bounded at 1000 (mirrored by a DB CHECK) so `total * weight` cannot leave
   * the safe integer range — 1e12 cents × 1000 = 1e15 < 2^53.
   */
  weight: number;
};

export const MAX_WEIGHT = 1000;

/**
 * `numeric` arrives from Drizzle as a **string**, and `Number("10.07") * 100` is
 * 1006.9999999999999. Parse the decimal by hand instead of touching a float.
 *
 * Accepts both `"20"` and `"20.00"`: the column round-trips two decimals, but
 * `plaid-sync` writes `String(t.amount)`, which drops them on whole dollars.
 */
export const toCents = (value: string): number => {
  const match = /^\s*(-?)(\d+)(?:\.(\d{1,2}))?\s*$/.exec(value);

  if (!match) throw new Error(`not a numeric(12,2): ${JSON.stringify(value)}`);

  const [, sign, whole = "", fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));

  // `-0` would compare unequal to `0` under Object.is and read as "-0.00".
  if (cents === 0) return 0;

  return sign === "-" ? -cents : cents;
};

/** Back to the `numeric(12,2)` string Postgres expects. */
export const fromCents = (cents: number): string => {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`not an integer cent amount: ${cents}`);
  }

  const magnitude = Math.abs(cents);

  return `${cents < 0 ? "-" : ""}${Math.trunc(magnitude / 100)}.${String(
    magnitude % 100,
  ).padStart(2, "0")}`;
};

/**
 * Largest-remainder (Hamilton) allocation of `totalCents` across `parts`.
 *
 * Three properties everything downstream depends on:
 *
 * 1. **Exact** — the results always sum to `totalCents`, for either sign. No
 *    rounding happens at read time anywhere in the app, so this is the only
 *    place a cent could go missing.
 * 2. **Sign-symmetric** — allocates on the *magnitude* and re-applies the sign,
 *    so `allocate(-t, w)` is `allocate(t, w)` negated elementwise. Flooring a
 *    negative directly would hand the odd cent to a different member than the
 *    positive case, and a full refund would settle to a stray cent instead of
 *    to zero.
 * 3. **Stable** — ties break on `memberId` ascending, using `<` rather than
 *    `localeCompare` (which is locale- and ICU-dependent, so it can differ
 *    between the phone and the server). Deliberately *not* a per-transaction
 *    seed: a refund is a different transaction, so a seeded tiebreak would send
 *    the odd cent elsewhere and strand ±$0.01 between two people forever.
 *
 * The accepted cost of (3) is that on an even split the lowest uuid always eats
 * the extra cent. Rotating it for fairness would cost exactness, which is not a
 * trade worth making.
 */
export const allocate = (
  totalCents: number,
  parts: readonly AllocationPart[],
): Map<string, number> => {
  if (!Number.isSafeInteger(totalCents)) {
    throw new Error(`allocate: not an integer cent amount: ${totalCents}`);
  }
  if (parts.length === 0) throw new Error("allocate: no parts");

  let totalWeight = 0;

  for (const part of parts) {
    if (!Number.isInteger(part.weight) || part.weight <= 0) {
      throw new Error(`allocate: weight must be a positive integer`);
    }
    if (part.weight > MAX_WEIGHT) {
      throw new Error(`allocate: weight exceeds ${MAX_WEIGHT}`);
    }
    totalWeight += part.weight;
  }

  const sign = totalCents < 0 ? -1 : 1;
  const total = Math.abs(totalCents);

  const rows = parts.map((part) => ({
    memberId: part.memberId,
    cents: Math.floor((total * part.weight) / totalWeight),
    remainder: (total * part.weight) % totalWeight,
  }));

  let leftover = total - rows.reduce((sum, row) => sum + row.cents, 0);

  // A shallow copy, so mutating `cents` below also mutates `rows` — the sort is
  // only there to decide who gets the spare cents, not to reorder the output.
  for (const row of [...rows].sort(
    (a, b) => b.remainder - a.remainder || (a.memberId < b.memberId ? -1 : 1),
  )) {
    if (leftover <= 0) break;
    row.cents += 1;
    leftover -= 1;
  }

  const allocated = new Map<string, number>();

  for (const row of rows) {
    // A duplicate would silently collapse in the Map and break the sum.
    if (allocated.has(row.memberId)) {
      throw new Error(`allocate: duplicate memberId ${row.memberId}`);
    }
    allocated.set(row.memberId, row.cents === 0 ? 0 : sign * row.cents);
  }

  return allocated;
};

/** An equal split — the shape `defaultSplit: "equal"` and the editor both use. */
export const equalParts = (memberIds: readonly string[]): AllocationPart[] =>
  memberIds.map((memberId) => ({ memberId, weight: 1 }));
