import { describe, expect, it } from "vitest";
import type { Balance } from "./ledger";
import { simplify, type Transfer } from "./settle-up";

/** Applies every transfer and hands back what each member is left holding. */
const apply = (
  balances: readonly Balance[],
  transfers: readonly Transfer[],
) => {
  const net = new Map(
    balances.map((balance) => [balance.memberId, balance.netCents]),
  );

  for (const transfer of transfers) {
    net.set(
      transfer.fromMemberId,
      (net.get(transfer.fromMemberId) ?? 0) + transfer.amountCents,
    );
    net.set(
      transfer.toMemberId,
      (net.get(transfer.toMemberId) ?? 0) - transfer.amountCents,
    );
  }

  return net;
};

const isSettled = (net: Map<string, number>) =>
  [...net.values()].every((cents) => cents === 0);

describe("simplify", () => {
  it("squares a four-way group up in three transfers", () => {
    const balances: Balance[] = [
      { memberId: "alice", netCents: 5000 },
      { memberId: "dave", netCents: 1500 },
      { memberId: "bob", netCents: -2500 },
      { memberId: "carol", netCents: -4000 },
    ];

    const transfers = simplify(balances);

    expect(transfers).toHaveLength(3);
    expect(isSettled(apply(balances, transfers))).toBe(true);
  });

  it("suggests nothing for a group that is already settled", () => {
    expect(
      simplify([
        { memberId: "alice", netCents: 0 },
        { memberId: "bob", netCents: 0 },
      ]),
    ).toEqual([]);
  });

  it("suggests exactly one transfer between two people", () => {
    expect(
      simplify([
        { memberId: "alice", netCents: 2500 },
        { memberId: "bob", netCents: -2500 },
      ]),
    ).toEqual([
      { amountCents: 2500, fromMemberId: "bob", toMemberId: "alice" },
    ]);
  });

  it("moves exactly what the creditors are owed", () => {
    const balances: Balance[] = [
      { memberId: "alice", netCents: 5000 },
      { memberId: "dave", netCents: 1500 },
      { memberId: "bob", netCents: -2500 },
      { memberId: "carol", netCents: -4000 },
    ];

    const moved = simplify(balances).reduce(
      (total, transfer) => total + transfer.amountCents,
      0,
    );

    expect(moved).toBe(6500);
  });

  it("returns the same list for the same balances", () => {
    const balances: Balance[] = [
      { memberId: "b", netCents: -1000 },
      { memberId: "a", netCents: 1000 },
    ];

    expect(simplify(balances)).toEqual(simplify([...balances].reverse()));
  });

  it("settles any zero-sum group in at most one transfer per member", () => {
    // The two properties every caller relies on: applying the list zeroes
    // everybody, and the list is short enough to be worth showing a human.
    for (let seed = 1; seed <= 300; seed += 1) {
      const size = 2 + (seed % 7);
      const raw = Array.from({ length: size }, (_, i) => ({
        memberId: `m${i}`,
        netCents: (((seed * (i + 3) * 7919) % 20_001) - 10_000) * 1,
      }));

      // Force the set to sum to zero, which holds of every real group.
      const drift = raw.reduce((total, row) => total + row.netCents, 0);
      const balances = raw.map((row, i) =>
        i === 0 ? { ...row, netCents: row.netCents - drift } : row,
      );

      const transfers = simplify(balances);

      expect(isSettled(apply(balances, transfers))).toBe(true);
      expect(transfers.length).toBeLessThanOrEqual(size - 1);
      expect(transfers.every((transfer) => transfer.amountCents > 0)).toBe(
        true,
      );
    }
  });
});
