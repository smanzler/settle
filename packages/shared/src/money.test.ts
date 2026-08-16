import { describe, expect, it } from "vitest";
import { allocate, equalParts, fromCents, toCents } from "./money";

const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `m${String(i).padStart(2, "0")}`);

const sum = (allocated: Map<string, number>) =>
  [...allocated.values()].reduce((total, cents) => total + cents, 0);

/** Deterministic LCG — a seeded property test reproduces on failure. */
const lcg = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 2 ** 32;
  return seed / 2 ** 32;
};

describe("toCents", () => {
  it("reads both the padded and unpadded forms", () => {
    // The column round-trips "20.00"; plaid-sync writes String(20) as "20".
    expect(toCents("20.00")).toBe(2000);
    expect(toCents("20")).toBe(2000);
    expect(toCents("20.5")).toBe(2050);
  });

  it("keeps sign and small magnitudes", () => {
    expect(toCents("-12.34")).toBe(-1234);
    expect(toCents("0.07")).toBe(7);
    expect(toCents("-0.01")).toBe(-1);
  });

  it("never returns -0, which would compare unequal to 0", () => {
    expect(Object.is(toCents("-0.00"), 0)).toBe(true);
  });

  it("survives the amounts float math would corrupt", () => {
    // Number("10.07") * 100 is 1006.9999999999999.
    expect(toCents("10.07")).toBe(1007);
    expect(toCents("1234567890.12")).toBe(123456789012);
  });

  it("throws rather than guessing", () => {
    // An empty string is the dangerous one: Number("") is 0, so a silent
    // parse would post a $0.00 share instead of failing.
    expect(() => toCents("")).toThrow();
    expect(() => toCents("abc")).toThrow();
    expect(() => toCents("1.234")).toThrow();
  });
});

describe("fromCents", () => {
  it("round-trips through toCents", () => {
    for (const cents of [0, 1, -1, 7, 2000, -123456, 123456789012]) {
      expect(toCents(fromCents(cents))).toBe(cents);
    }
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
