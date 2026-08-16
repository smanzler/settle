import {
  formatAccountLabel,
  formatCategory,
  formatMemberInitials,
  formatTransactionAmount,
} from "./format";

describe("formatTransactionAmount", () => {
  test("a positive amount is an outflow — Plaid's sign convention", () => {
    expect(
      formatTransactionAmount({ amount: "12.34", currency: "USD" }),
    ).toEqual({
      text: "$12.34",
      isInflow: false,
    });
  });

  test("a negative amount is an inflow and is marked with +", () => {
    expect(
      formatTransactionAmount({ amount: "-1250.5", currency: "USD" }),
    ).toEqual({
      text: "+$1,250.50",
      isInflow: true,
    });
  });

  test("zero is not an inflow", () => {
    expect(
      formatTransactionAmount({ amount: "0", currency: "USD" }).isInflow,
    ).toBe(false);
  });

  test("falls back to a plain decimal when the currency is null", () => {
    expect(
      formatTransactionAmount({ amount: "12.34", currency: null }),
    ).toEqual({
      text: "12.34",
      isInflow: false,
    });
  });

  test("falls back to a plain decimal for an unofficial currency code", () => {
    expect(
      formatTransactionAmount({ amount: "12.34", currency: "XBT" }).text,
    ).toContain("12.34");
  });

  test("returns a dash for a non-numeric amount", () => {
    expect(formatTransactionAmount({ amount: "not-a-number" }).text).toBe("—");
  });

  test("returns a dash for an empty string rather than $0.00", () => {
    // Number("") is 0, which would render as a real zero-dollar transaction.
    expect(formatTransactionAmount({ amount: "" }).text).toBe("—");
  });
});

describe("formatAccountLabel", () => {
  test("appends the mask when present", () => {
    expect(formatAccountLabel({ name: "Sapphire", mask: "4242" })).toBe(
      "Sapphire •••• 4242",
    );
  });

  test("omits the mask when absent", () => {
    expect(formatAccountLabel({ name: "Sapphire", mask: null })).toBe(
      "Sapphire",
    );
  });
});

describe("formatCategory", () => {
  test("humanizes a Plaid category", () => {
    expect(formatCategory("FOOD_AND_DRINK")).toBe("Food and drink");
  });

  test("returns null when there is no category", () => {
    expect(formatCategory(null)).toBeNull();
  });
});

describe("formatMemberInitials", () => {
  test("takes one letter from each of the first two words", () => {
    expect(formatMemberInitials("Simon Manzler")).toBe("SM");
  });

  test("ignores words past the second", () => {
    expect(formatMemberInitials("Ana Maria Silva")).toBe("AM");
  });

  test("takes two letters from a single word", () => {
    expect(formatMemberInitials("simon")).toBe("SI");
  });

  test("gives one letter for a one-letter name", () => {
    // charAt past the end returns "" rather than undefined.
    expect(formatMemberInitials("s")).toBe("S");
  });

  test("collapses runs of whitespace", () => {
    expect(formatMemberInitials("  Simon   Manzler  ")).toBe("SM");
  });

  test("returns a question mark for an empty name", () => {
    expect(formatMemberInitials("   ")).toBe("?");
  });
});
