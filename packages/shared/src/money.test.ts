import { describe, expect, it } from "vitest";
import { allocate, equalParts, fromCents } from "./money";

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `m${String(i).padStart(2, "0")}`);

const sum = (allocated: Map<string, number>) =>
  [...allocated.values()].reduce((total, cents) => total + cents, 0);

/** Deterministic LCG — a seeded property test reproduces on failure. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

describe("fromCents", () => {
  it("refuses anything that is not an integer cent amount", () => {
    expect(() => fromCents(12.5)).toThrow(/integer cent/);
    expect(() => fromCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      /integer cent/,
    );
  });

  it("pads the fractional part", () => {
    expect(fromCents(5)).toBe("0.05");
    expect(fromCents(-5)).toBe("-0.05");
    expect(fromCents(2000)).toBe("20.00");
  });
});

describe("allocate", () => {
  it("splits $100 three ways without losing a cent", () => {
    const allocated = allocate(10000, equalParts(ids(3)));

    expect([...allocated.values()]).toEqual([3334, 3333, 3333]);
    expect(sum(allocated)).toBe(10000);
  });

  it("spreads more than one leftover cent", () => {
    // 1001 / 3 = 333 each with 2 left over.
    const allocated = allocate(1001, equalParts(ids(3)));

    expect([...allocated.values()]).toEqual([334, 334, 333]);
    expect(sum(allocated)).toBe(1001);
  });

  it("gives the odd cent to the largest remainder, not the lowest id", () => {
    // 1000 × 2/3 = 666r2, 1000 × 1/3 = 333r1 — the weight-2 member wins.
    const allocated = allocate(1000, [
      { memberId: "m00", weight: 2 },
      { memberId: "m01", weight: 1 },
    ]);

    expect(allocated.get("m00")).toBe(667);
    expect(allocated.get("m01")).toBe(333);
  });

  it("is sign-symmetric elementwise, so a refund nets a charge to zero", () => {
    const parts = equalParts(ids(3));
    const charge = allocate(10000, parts);
    const refund = allocate(-10000, parts);

    for (const [memberId, cents] of charge) {
      expect(refund.get(memberId)).toBe(-cents);
    }
    expect(sum(refund)).toBe(-10000);
  });

  it("does not depend on the order parts are passed in", () => {
    const forwards = allocate(10000, equalParts(ids(3)));
    const backwards = allocate(10000, equalParts(ids(3).reverse()));

    for (const [memberId, cents] of forwards) {
      expect(backwards.get(memberId)).toBe(cents);
    }
  });

  it("returns the input order, so callers can zip against parts", () => {
    const parts = equalParts(["m02", "m00", "m01"]);

    expect([...allocate(10000, parts).keys()]).toEqual(["m02", "m00", "m01"]);
  });

  it("handles a zero total", () => {
    const allocated = allocate(0, equalParts(ids(3)));

    expect([...allocated.values()]).toEqual([0, 0, 0]);
  });

  it("sums exactly, and stays sign-symmetric, over random inputs", () => {
    const random = lcg(20260813);

    for (let run = 0; run < 2000; run++) {
      const count = 1 + Math.floor(random() * 6);
      const parts = ids(count).map((memberId) => ({
        memberId,
        weight: 1 + Math.floor(random() * 100),
      }));
      const total = Math.floor(random() * 2_000_000) - 1_000_000;

      const allocated = allocate(total, parts);
      expect(sum(allocated)).toBe(total);

      const mirrored = allocate(-total, parts);
      for (const [memberId, cents] of allocated) {
        expect(mirrored.get(memberId)).toBe(-cents);
      }
    }
  });

  it("rejects the inputs that would silently break the sum", () => {
    expect(() => allocate(100, [])).toThrow();
    expect(() => allocate(100, [{ memberId: "m00", weight: 0 }])).toThrow();
    expect(() => allocate(100, [{ memberId: "m00", weight: -1 }])).toThrow();
    expect(() => allocate(100, [{ memberId: "m00", weight: 1.5 }])).toThrow();
    expect(() => allocate(100, [{ memberId: "m00", weight: 1001 }])).toThrow();
    expect(() =>
      allocate(100, [
        { memberId: "m00", weight: 1 },
        { memberId: "m00", weight: 1 },
      ]),
    ).toThrow();
  });
});
