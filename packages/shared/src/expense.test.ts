import { describe, expect, it } from "vitest";
import {
  buildShares,
  expenseInputSchema,
  splitSchema,
  sumAmounts,
  type Split,
} from "./expense";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const equal = (...memberIds: string[]): Split => ({
  mode: "equal",
  memberIds,
});

describe("buildShares", () => {
  it("splits three ways and gives the odd cent away deterministically", () => {
    expect(buildShares(10_000, equal("a", "b", "c"))).toEqual([
      { memberId: "a", amountCents: 3334 },
      { memberId: "b", amountCents: 3333 },
      { memberId: "c", amountCents: 3333 },
    ]);
  });

  it("splits a single cent three ways without losing it", () => {
    expect(buildShares(1, equal("a", "b", "c"))).toEqual([
      { memberId: "a", amountCents: 1 },
      { memberId: "b", amountCents: 0 },
      { memberId: "c", amountCents: 0 },
    ]);
  });

  it("gives one participant the whole amount", () => {
    expect(buildShares(100, equal("a"))).toEqual([
      { memberId: "a", amountCents: 100 },
    ]);
  });

  it("is stable — the same input always resolves the same way", () => {
    const split = equal("c", "a", "b");

    expect(buildShares(10_001, split)).toEqual(buildShares(10_001, split));
  });

  it("passes an exact split straight through", () => {
    const parts = [
      { memberId: "a", amountCents: 5000 },
      { memberId: "b", amountCents: 3000 },
      { memberId: "c", amountCents: 2000 },
    ];

    expect(buildShares(10_000, { mode: "exact", parts })).toEqual(parts);
  });

  it("refuses an exact split that does not add up", () => {
    expect(() =>
      buildShares(10_000, {
        mode: "exact",
        parts: [{ memberId: "a", amountCents: 9999 }],
      }),
    ).toThrow(/does not add up/);
  });

  it("always partitions the amount exactly, for any split", () => {
    // A property rather than a table: the one thing every caller depends on is
    // that no cent is invented or lost, whatever the amount and the party size.
    for (let seed = 0; seed < 500; seed += 1) {
      const amountCents = 1 + ((seed * 7919) % 250_000);
      const size = 1 + (seed % 9);
      const memberIds = Array.from({ length: size }, (_, i) => uuid(i));

      const shares = buildShares(amountCents, equal(...memberIds));

      expect(shares).toHaveLength(size);
      expect(shares.every((share) => share.amountCents >= 0)).toBe(true);
      expect(sumAmounts(shares)).toBe(amountCents);
    }
  });
});

describe("splitSchema", () => {
  it("refuses a member named twice", () => {
    const result = splitSchema.safeParse({
      mode: "equal",
      memberIds: [uuid(1), uuid(1)],
    });

    expect(result.success).toBe(false);
  });
});

describe("expenseInputSchema", () => {
  const base = {
    amountCents: 6000,
    description: "Dinner",
    expenseDate: "2026-08-03",
    split: { mode: "equal" as const, memberIds: [uuid(1), uuid(2)] },
  };

  it("accepts payers that add up to the amount", () => {
    const result = expenseInputSchema.safeParse({
      ...base,
      payers: [{ memberId: uuid(1), amountCents: 6000 }],
    });

    expect(result.success).toBe(true);
  });

  it("refuses payers that do not add up to the amount", () => {
    const result = expenseInputSchema.safeParse({
      ...base,
      payers: [{ memberId: uuid(1), amountCents: 5900 }],
    });

    expect(result.success).toBe(false);
  });

  it("refuses a zero amount", () => {
    const result = expenseInputSchema.safeParse({
      ...base,
      amountCents: 0,
      payers: [{ memberId: uuid(1), amountCents: 0 }],
    });

    expect(result.success).toBe(false);
  });
});
