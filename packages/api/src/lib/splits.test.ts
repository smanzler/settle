import { describe, expect, it } from "vitest";
import {
  assertSplitsBalance,
  isNeverSplit,
  partsFromWeights,
  reallocateForAmountChange,
  resolveDefaultSplit,
  splitsToPairs,
  sumCents,
  type SplitPart,
} from "./splits";

const SIMON = "11111111-1111-4111-8111-111111111111";
const ANA = "22222222-2222-4222-8222-222222222222";

const account = (
  over: Partial<Parameters<typeof resolveDefaultSplit>[0]["account"]> = {},
) => ({
  defaultSplit: "equal" as const,
  defaultSplitFrom: null,
  isPrivate: false,
  excludedAt: null,
  ...over,
});

const transaction = (
  over: Partial<Parameters<typeof resolveDefaultSplit>[0]["transaction"]> = {},
) => ({
  date: "2026-08-13",
  category: "FOOD_AND_DRINK",
  categoryDetailed: null,
  isoCurrencyCode: "USD",
  ...over,
});

describe("resolveDefaultSplit", () => {
  const base = {
    creditorMemberId: SIMON,
    totalCents: 10000,
    householdCurrency: "USD",
    memberIds: [SIMON, ANA],
  };

  it("splits equally when the account says so", () => {
    const { method, parts } = resolveDefaultSplit({
      ...base,
      transaction: transaction(),
      account: account(),
    });

    expect(method).toBe("shares");
    expect(sumCents(parts)).toBe(10000);
    expect(parts).toHaveLength(2);
  });

  it("leaves the whole amount on the payer by default", () => {
    const { method, parts } = resolveDefaultSplit({
      ...base,
      transaction: transaction(),
      account: account({ defaultSplit: "owner" }),
    });

    expect(method).toBe("owner");
    expect(parts).toEqual([{ memberId: SIMON, weight: 1, amountCents: 10000 }]);
  });

  it("does not invent retroactive debt for transactions before the cutover", () => {
    // The whole point of default_split_from: flipping the switch today must not
    // reach back through two years of Plaid history.
    const before = resolveDefaultSplit({
      ...base,
      transaction: transaction({ date: "2026-07-01" }),
      account: account({ defaultSplitFrom: "2026-08-01" }),
    });
    const after = resolveDefaultSplit({
      ...base,
      transaction: transaction({ date: "2026-08-01" }),
      account: account({ defaultSplitFrom: "2026-08-01" }),
    });

    expect(before.method).toBe("owner");
    expect(after.method).toBe("shares");
  });

  it("never auto-splits income, transfers or card payments", () => {
    for (const t of [
      transaction({ category: "INCOME" }),
      transaction({ category: "TRANSFER_IN" }),
      transaction({ category: "TRANSFER_OUT" }),
      transaction({ categoryDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" }),
    ]) {
      expect(isNeverSplit(t)).toBe(true);
      expect(
        resolveDefaultSplit({ ...base, transaction: t, account: account() })
          .method,
      ).toBe("owner");
    }
  });

  it("stays owner-only on private and excluded accounts", () => {
    expect(
      resolveDefaultSplit({
        ...base,
        transaction: transaction(),
        account: account({ isPrivate: true }),
      }).method,
    ).toBe("owner");

    expect(
      resolveDefaultSplit({
        ...base,
        transaction: transaction(),
        account: account({ excludedAt: new Date() }),
      }).method,
    ).toBe("owner");
  });

  it("never auto-splits a transaction in another currency", () => {
    // `transactions.setSplit` refuses these by hand; the sync path has to agree,
    // or it raises debt in a currency `settlements.create` can never pay off.
    expect(
      resolveDefaultSplit({
        ...base,
        transaction: transaction({ isoCurrencyCode: "EUR" }),
        account: account(),
      }).method,
    ).toBe("owner");

    // Plaid nulls `iso_currency_code` when it sets an unofficial one; the
    // household's own currency is the documented fallback everywhere else.
    expect(
      resolveDefaultSplit({
        ...base,
        transaction: transaction({ isoCurrencyCode: null }),
        account: account(),
      }).method,
    ).toBe("shares");
  });

  it("degrades to owner-only for a household of one", () => {
    const { method } = resolveDefaultSplit({
      ...base,
      memberIds: [SIMON],
      transaction: transaction(),
      account: account(),
    });

    expect(method).toBe("owner");
  });

  it("always includes the payer, even if they fell out of the member list", () => {
    const { parts } = resolveDefaultSplit({
      ...base,
      memberIds: [ANA],
      transaction: transaction(),
      account: account(),
    });

    expect(parts.map((p) => p.memberId)).toContain(SIMON);
    expect(sumCents(parts)).toBe(10000);
  });
});

describe("reallocateForAmountChange", () => {
  const shares: SplitPart[] = [
    { memberId: SIMON, weight: 7, amountCents: 7000 },
    { memberId: ANA, weight: 3, amountCents: 3000 },
  ];

  it("preserves a manual 70/30 through a Plaid amount change", () => {
    const { parts, splitsStale } = reallocateForAmountChange({
      method: "shares",
      creditorMemberId: SIMON,
      existing: shares,
      newCents: 5000,
    });

    expect(parts).toEqual([
      { memberId: SIMON, weight: 7, amountCents: 3500 },
      { memberId: ANA, weight: 3, amountCents: 1500 },
    ]);
    expect(splitsStale).toBe(false);
  });

  it("hands the variance to the payer for an exact split", () => {
    // The pending $50 posts at $53.40 with the tip.
    const { method, parts, splitsStale } = reallocateForAmountChange({
      method: "exact",
      creditorMemberId: SIMON,
      existing: [
        { memberId: SIMON, weight: 1, amountCents: 2000 },
        { memberId: ANA, weight: 1, amountCents: 3000 },
      ],
      newCents: 5340,
    });

    expect(method).toBe("exact");
    expect(parts).toEqual([
      { memberId: SIMON, weight: 1, amountCents: 2340 },
      { memberId: ANA, weight: 1, amountCents: 3000 },
    ]);
    expect(sumCents(parts)).toBe(5340);
    expect(splitsStale).toBe(true);
  });

  it("resets rather than flipping the payer's share negative", () => {
    // $100 split $10 payer / $90 other, dropping to $40. Absorbing blindly puts
    // the payer at -$50, i.e. owed $90 on a $40 dinner.
    const { method, parts, splitsStale } = reallocateForAmountChange({
      method: "exact",
      creditorMemberId: SIMON,
      existing: [
        { memberId: SIMON, weight: 1, amountCents: 1000 },
        { memberId: ANA, weight: 1, amountCents: 9000 },
      ],
      newCents: 4000,
    });

    expect(method).toBe("owner");
    expect(parts).toEqual([{ memberId: SIMON, weight: 1, amountCents: 4000 }]);
    expect(splitsStale).toBe(true);
  });

  it("resets when a charge turns into a refund", () => {
    const { method, splitsStale } = reallocateForAmountChange({
      method: "exact",
      creditorMemberId: SIMON,
      existing: [
        { memberId: SIMON, weight: 1, amountCents: 2000 },
        { memberId: ANA, weight: 1, amountCents: 3000 },
      ],
      newCents: -5000,
    });

    expect(method).toBe("owner");
    expect(splitsStale).toBe(true);
  });

  it("resets when the payer's share would exceed the whole amount", () => {
    const { method } = reallocateForAmountChange({
      method: "exact",
      creditorMemberId: SIMON,
      existing: [
        { memberId: SIMON, weight: 1, amountCents: 9000 },
        { memberId: ANA, weight: 1, amountCents: 1000 },
      ],
      newCents: 500,
    });

    expect(method).toBe("owner");
  });

  it("keeps a refund's shares proportional, so it nets its charge to zero", () => {
    const charge = partsFromWeights(10000, [
      { memberId: SIMON, weight: 1 },
      { memberId: ANA, weight: 1 },
      { memberId: "33333333-3333-4333-8333-333333333333", weight: 1 },
    ]);
    const refund = reallocateForAmountChange({
      method: "shares",
      creditorMemberId: SIMON,
      existing: charge,
      newCents: -10000,
    });

    for (const part of charge) {
      const mirrored = refund.parts.find((p) => p.memberId === part.memberId);
      expect(mirrored?.amountCents).toBe(-part.amountCents);
    }
  });

  /**
   * "I paid, the two of you split it" — the payer is not in the split at all.
   *
   * This used to be stored as the participants plus a fabricated
   * `{ payer, weight: 1, amountCents: 0 }` row, and that weight read as a full
   * equal share the next time Plaid moved the amount.
   */
  describe("a split that omits the payer", () => {
    const CARLA = "33333333-3333-4333-8333-333333333333";

    const withoutPayer = partsFromWeights(9900, [
      { memberId: ANA, weight: 1 },
      { memberId: CARLA, weight: 1 },
    ]);

    it("does not hand the payer a share when the amount changes", () => {
      const { parts } = reallocateForAmountChange({
        method: "shares",
        creditorMemberId: SIMON,
        existing: withoutPayer,
        newCents: 12000,
      });

      expect(parts.find((part) => part.memberId === SIMON)).toBeUndefined();
      expect(parts).toEqual([
        { memberId: ANA, weight: 1, amountCents: 6000 },
        { memberId: CARLA, weight: 1, amountCents: 6000 },
      ]);
    });

    it("nets a full refund to zero for everyone", () => {
      const refund = reallocateForAmountChange({
        method: "shares",
        creditorMemberId: SIMON,
        existing: withoutPayer,
        newCents: -9900,
      });

      for (const part of withoutPayer) {
        const mirrored = refund.parts.find((p) => p.memberId === part.memberId);
        expect(mirrored?.amountCents).toBe(-part.amountCents);
      }
    });

    it("absorbs an exact split's variance onto the payer rather than resetting", () => {
      // Nobody to absorb onto used to mean `creditor === undefined`, which
      // reset the whole split to owner-only.
      const { method, parts, splitsStale } = reallocateForAmountChange({
        method: "exact",
        creditorMemberId: SIMON,
        existing: [
          { memberId: ANA, weight: 1, amountCents: 2500 },
          { memberId: CARLA, weight: 1, amountCents: 2500 },
        ],
        newCents: 5340,
      });

      expect(method).toBe("exact");
      expect(parts).toEqual([
        { memberId: ANA, weight: 1, amountCents: 2500 },
        { memberId: CARLA, weight: 1, amountCents: 2500 },
        // The tip lands on the person who actually paid it.
        { memberId: SIMON, weight: 1, amountCents: 340 },
      ]);
      expect(splitsStale).toBe(true);
    });

    it("leaves the payer out when there is no variance to absorb", () => {
      const { parts } = reallocateForAmountChange({
        method: "exact",
        creditorMemberId: SIMON,
        existing: [
          { memberId: ANA, weight: 1, amountCents: 2500 },
          { memberId: CARLA, weight: 1, amountCents: 2500 },
        ],
        newCents: 5000,
      });

      expect(parts.find((part) => part.memberId === SIMON)).toBeUndefined();
    });
  });
});

describe("splitsToPairs", () => {
  it("drops the payer's own share and any zero share", () => {
    const pairs = splitsToPairs(SIMON, [
      { memberId: SIMON, weight: 1, amountCents: 5000 },
      { memberId: ANA, weight: 1, amountCents: 5000 },
      {
        memberId: "33333333-3333-4333-8333-333333333333",
        weight: 1,
        amountCents: 0,
      },
    ]);

    expect(pairs).toEqual([
      { debtorMemberId: ANA, creditorMemberId: SIMON, cents: 5000 },
    ]);
  });

  it("carries the sign through, so a refund reverses the debt", () => {
    const pairs = splitsToPairs(SIMON, [
      { memberId: SIMON, weight: 1, amountCents: -5000 },
      { memberId: ANA, weight: 1, amountCents: -5000 },
    ]);

    expect(pairs).toEqual([
      { debtorMemberId: ANA, creditorMemberId: SIMON, cents: -5000 },
    ]);
  });

  it("produces nothing at all for an owner-only split", () => {
    expect(
      splitsToPairs(SIMON, [
        { memberId: SIMON, weight: 1, amountCents: 10000 },
      ]),
    ).toEqual([]);
  });
});

describe("assertSplitsBalance", () => {
  it("accepts an exact partition and rejects a lost cent", () => {
    expect(() =>
      assertSplitsBalance({
        amount: "100.00",
        context: "test",
        parts: partsFromWeights(10000, [
          { memberId: SIMON, weight: 1 },
          { memberId: ANA, weight: 1 },
        ]),
      }),
    ).not.toThrow();

    expect(() =>
      assertSplitsBalance({
        amount: "100.00",
        context: "test",
        parts: [
          { memberId: SIMON, weight: 1, amountCents: 3333 },
          { memberId: ANA, weight: 1, amountCents: 3333 },
        ],
      }),
    ).toThrow(/partition broken/);
  });

  it("compares against the DB-normalized amount, not the raw string", () => {
    // plaid-sync writes String(20) as "20"; the column round-trips "20.00".
    expect(() =>
      assertSplitsBalance({
        amount: "20",
        context: "test",
        parts: [{ memberId: SIMON, weight: 1, amountCents: 2000 }],
      }),
    ).not.toThrow();
  });
});
