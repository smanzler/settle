import { formatSignedCents, parseAmountCents } from "./money";

/**
 * `parseAmountCents` replaced two near-identical parsers — one behind the
 * settle-up field, one behind the split editor's amount boxes — which disagreed
 * on exactly the half-typed inputs a keypad produces. These cases are what the
 * single parser now has to get right for both.
 */
describe("parseAmountCents", () => {
  it("parses whole and fractional dollars", () => {
    expect(parseAmountCents("12")).toBe(1200);
    expect(parseAmountCents("12.3")).toBe(1230);
    expect(parseAmountCents("12.34")).toBe(1234);
    expect(parseAmountCents(".5")).toBe(50);
  });

  it("accepts the states a keypad passes through", () => {
    // None of these may throw or read as invalid: they are what a field holds
    // mid-typing, and `toCents` rejects every one of them.
    expect(parseAmountCents("")).toBe(0);
    expect(parseAmountCents("12.")).toBe(1200);
    expect(parseAmountCents("0")).toBe(0);
  });

  it("strips formatting so a field's own output pastes back in", () => {
    expect(parseAmountCents("$1,234.56")).toBe(123456);
  });

  it("rejects what is not a number at all", () => {
    // Stripping alone would leave "abc" as "" and read it as zero, which is how
    // a pasted word would land in the ledger as a $0.00 share.
    expect(parseAmountCents("abc")).toBeNull();
    expect(parseAmountCents(".")).toBeNull();
    expect(parseAmountCents("1.2.3")).toBeNull();
    expect(parseAmountCents("12.345")).toBeNull();
  });

  it("rejects amounts past the numeric(12,2) ceiling", () => {
    // `fromCents` throws above the safe-integer range, which would take the
    // screen down mid-render rather than just disabling Save.
    expect(parseAmountCents("9999999999.99")).toBe(999_999_999_999);
    expect(parseAmountCents("10000000000")).toBeNull();
  });
});

describe("formatSignedCents", () => {
  it("signs both directions and leaves zero bare", () => {
    expect(formatSignedCents(1234, "USD")).toBe("+$12.34");
    // U+2212, so the sign sits at digit width.
    expect(formatSignedCents(-1234, "USD")).toBe("−$12.34");
    expect(formatSignedCents(0, "USD")).toBe("$0.00");
  });

  it("renders a corrupt amount rather than throwing", () => {
    expect(formatSignedCents(1.5, "USD")).toBe("+—");
  });
});
