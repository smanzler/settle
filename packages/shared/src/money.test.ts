import { describe, expect, it } from "vitest";
import { fromCents } from "./money";

describe("fromCents", () => {
  it("pads the fractional part", () => {
    expect(fromCents(5)).toBe("0.05");
    expect(fromCents(-5)).toBe("-0.05");
    expect(fromCents(2000)).toBe("20.00");
    expect(fromCents(0)).toBe("0.00");
  });

  it("refuses anything that is not an integer cent amount", () => {
    expect(() => fromCents(12.5)).toThrow(/integer cent/);
    expect(() => fromCents(Number.MAX_SAFE_INTEGER + 2)).toThrow(
      /integer cent/,
    );
  });
});
