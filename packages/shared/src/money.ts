/**
 * Integer-cent money, shared by the API and the clients.
 *
 * Lives in `shared` rather than `api` on purpose: the split editor previews the
 * exact cents the server will store, so the preview and the write are
 * byte-identical. A second, subtly different rounding implementation on the
 * client is how a UI ends up disagreeing with its own database.
 */

/** A member's slice of an expense, expressed as a weight rather than cents. */
export type AllocationPart = {
  memberId: string;
  /**
   * Relative share. Equal split = all 1s; percentages = weights out of 100.
   * Never stored: the database holds the cents these resolve to, not the weights
   * themselves, so this only has to survive the arithmetic below. Bounded at 1000
   * so `total * weight` cannot leave the safe integer range: 1e12 × 1000 = 1e15.
   */
  weight: number;
};

export const MAX_WEIGHT = 1000;

/**
 * `4000` → `"40.00"`.
 *
 * Base-ten string assembly by integer arithmetic, never `cents / 100`: the only
 * place a rendered figure could disagree with the ledger that produced it.
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
 *    positive case. Nothing posts a negative amount today, and the symmetry is
 *    what keeps that from becoming a rounding bug the day something does.
 * 3. **Stable** — ties break on `memberId` ascending, using `<` rather than
 *    `localeCompare` (which is locale- and ICU-dependent, so it can differ
 *    between the phone and the server). Deliberately *not* a per-transaction
 *    seed: a revision is a fresh allocation, so a seeded tiebreak would send the
 *    odd cent elsewhere on every edit and strand ±$0.01 between two people.
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

/** An equal split — the shape the editor and `buildShares` both use. */
export const equalParts = (memberIds: readonly string[]): AllocationPart[] =>
  memberIds.map((memberId) => ({ memberId, weight: 1 }));
