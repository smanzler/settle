import { buildShares, type ExpenseInput } from "@budget/shared";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import db from "../db";
import { createScratchGroup, dropScratchGroups } from "../db/scratch";
import { Settlements } from "../db/schema";
import { createExpense, deleteExpense, reviseExpense } from "./expenses";
import {
  getGroupImbalance,
  listGroupBalances,
  postSettlement,
  reverseSettlement,
} from "./ledger";

/**
 * These exercise the real invariants — an append-only table, a trigger, a row
 * lock and a signed aggregate — so a mock would only test the mock. They need a
 * live Postgres with the migrations applied, which CI does not have, so they are
 * opt-in:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://budget:budget@localhost:25432/budget pnpm --filter @budget/api test
 *
 * Every group they create is dropped in `afterAll`, so a development database is
 * a safe target.
 */
const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL);
const describeDb = enabled ? describe : describe.skip;

const groupIds: string[] = [];

afterAll(async () => {
  if (!enabled) return;

  await dropScratchGroups(groupIds);
  await db.$client.end();
});

const scratch = async (memberNames: readonly string[]) => {
  const group = await createScratchGroup({ memberNames, name: "ledger test" });
  groupIds.push(group.groupId);

  return group;
};

/** Every member's net position, keyed by display name. */
const nets = async (
  groupId: string,
  members: Record<string, string>,
): Promise<Record<string, number>> => {
  const balances = await listGroupBalances(groupId);
  const names = Object.fromEntries(
    Object.entries(members).map(([name, id]) => [id, name]),
  );

  return Object.fromEntries(
    balances.map((balance) => [names[balance.memberId], balance.netCents]),
  );
};

/** The invariant every scenario ends on: a group's entries sum to zero. */
const expectHealthy = async (groupId: string) => {
  expect(await getGroupImbalance(groupId)).toBe(0);
};

/**
 * Every message in an error's cause chain.
 *
 * Drizzle wraps a failed statement in a `Failed query: ...` error and hangs the
 * driver's own error — the one carrying the trigger's text — off `cause`.
 */
const messageChain = (error: unknown): string => {
  const parts: string[] = [];

  for (let current = error; current instanceof Error; current = current.cause) {
    parts.push(current.message);
  }

  return parts.join(" | ");
};

const expectRefused = async (statement: Promise<unknown>, pattern: RegExp) => {
  let caught: unknown;

  try {
    await statement;
  } catch (error) {
    caught = error;
  }

  expect(caught, "the statement was not refused").toBeDefined();
  expect(messageChain(caught)).toMatch(pattern);
};

const dinner = (
  overrides: Partial<ExpenseInput> & Pick<ExpenseInput, "payers" | "split">,
): ExpenseInput => ({
  amountCents: 6000,
  description: "Dinner",
  expenseDate: "2026-08-03",
  ...overrides,
});

describeDb("posting an expense", () => {
  it("credits the payer and debits every participant", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob", "Carol"]);
    const { Alice, Bob, Carol } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!, Carol!] },
      }),
    });

    expect(await nets(groupId, members)).toEqual({
      Alice: 4000,
      Bob: -2000,
      Carol: -2000,
    });
    await expectHealthy(groupId);
  });

  it("handles two payers on one expense", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob", "Carol"]);
    const { Alice, Bob, Carol } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [
          { memberId: Alice!, amountCents: 4000 },
          { memberId: Bob!, amountCents: 2000 },
        ],
        split: { mode: "equal", memberIds: [Alice!, Bob!, Carol!] },
      }),
    });

    expect(await nets(groupId, members)).toEqual({
      Alice: 2000,
      Bob: 0,
      Carol: -2000,
    });
    await expectHealthy(groupId);
  });

  it("handles shares that are not equal", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob", "Carol"]);
    const { Alice, Bob, Carol } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        amountCents: 10_000,
        payers: [{ memberId: Alice!, amountCents: 10_000 }],
        split: {
          mode: "exact",
          parts: [
            { memberId: Alice!, amountCents: 5000 },
            { memberId: Bob!, amountCents: 3000 },
            { memberId: Carol!, amountCents: 2000 },
          ],
        },
      }),
    });

    expect(await nets(groupId, members)).toEqual({
      Alice: 5000,
      Bob: -3000,
      Carol: -2000,
    });
    await expectHealthy(groupId);
  });

  it("handles a payer who is not a participant", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob", "Carol"]);
    const { Alice, Bob, Carol } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Bob!, Carol!] },
      }),
    });

    expect(await nets(groupId, members)).toEqual({
      Alice: 6000,
      Bob: -3000,
      Carol: -3000,
    });
    await expectHealthy(groupId);
  });
});

describeDb("the append-only guarantee", () => {
  it("refuses a direct UPDATE", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    await expectRefused(
      db.execute(
        sql`update ledger_entries set amount_cents = 1 where group_id = ${groupId}`,
      ),
      /append-only/,
    );
  });

  it("refuses a direct DELETE", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    await expectRefused(
      db.execute(sql`delete from ledger_entries where group_id = ${groupId}`),
      /append-only/,
    );
  });
});

describeDb("revising an expense", () => {
  it("moves every balance to the new amount", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob", "Carol"]);
    const { Alice, Bob, Carol } = members;
    const everyone = [Alice!, Bob!, Carol!];

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: everyone },
      }),
    });

    const revised = await reviseExpense({
      actorMemberId: Alice!,
      expenseId,
      groupId,
      input: dinner({
        amountCents: 7500,
        note: "tip posted",
        payers: [{ memberId: Alice!, amountCents: 7500 }],
        split: { mode: "equal", memberIds: everyone },
      }),
    });

    expect(revised.version).toBe(2);
    expect(await nets(groupId, members)).toEqual({
      Alice: 5000,
      Bob: -2500,
      Carol: -2500,
    });
    await expectHealthy(groupId);
  });

  it("keeps every version on record across two revisions", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob", "Carol"]);
    const { Alice, Bob, Carol } = members;
    const everyone = [Alice!, Bob!, Carol!];

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: everyone },
      }),
    });

    for (const amountCents of [7500, 7000]) {
      await reviseExpense({
        actorMemberId: Alice!,
        expenseId,
        groupId,
        input: dinner({
          amountCents,
          payers: [{ memberId: Alice!, amountCents }],
          split: { mode: "equal", memberIds: everyone },
        }),
      });
    }

    const versions = await db.execute<{ count: string }>(
      sql`select count(*)::text as count from expense_versions where expense_id = ${expenseId}`,
    );

    expect(versions.rows[0]?.count).toBe("3");

    // $70 three ways leaves an odd cent, and which member absorbs it depends on
    // the uuids the scratch group happened to get. Deriving the expectation from
    // the same allocator the server used is the point — a hardcoded number here
    // would only test the fixture.
    const shares = new Map(
      buildShares(7000, { mode: "equal", memberIds: everyone }).map((share) => [
        share.memberId,
        share.amountCents,
      ]),
    );

    expect(await nets(groupId, members)).toEqual({
      Alice: 7000 - shares.get(Alice!)!,
      Bob: -shares.get(Bob!)!,
      Carol: -shares.get(Carol!)!,
    });
    await expectHealthy(groupId);
  });

  it("handles the participant set changing", async () => {
    const { groupId, members } = await scratch([
      "Alice",
      "Bob",
      "Carol",
      "Dave",
    ]);
    const { Alice, Bob, Carol, Dave } = members;

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!, Carol!] },
      }),
    });

    await reviseExpense({
      actorMemberId: Alice!,
      expenseId,
      groupId,
      input: dinner({
        note: "Carol wasn't there, Dave was",
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!, Dave!] },
      }),
    });

    expect(await nets(groupId, members)).toEqual({
      Alice: 4000,
      Bob: -2000,
      Carol: 0,
      Dave: -2000,
    });
    await expectHealthy(groupId);
  });

  it("links every reversal to the entry it undoes", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    await reviseExpense({
      actorMemberId: Alice!,
      expenseId,
      groupId,
      input: dinner({
        amountCents: 7000,
        payers: [{ memberId: Alice!, amountCents: 7000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    const reversals = await db.execute<{
      amount_cents: string;
      original_cents: string;
    }>(sql`
      select r.amount_cents::text as amount_cents,
             o.amount_cents::text as original_cents
      from ledger_entries r
      join ledger_entries o on o.id = r.reverses_id
      where r.group_id = ${groupId} and r.reverses_id is not null
    `);

    expect(reversals.rows).toHaveLength(3);
    expect(
      reversals.rows.every(
        (row) => Number(row.amount_cents) === -Number(row.original_cents),
      ),
    ).toBe(true);
    await expectHealthy(groupId);
  });

  it("refuses to revise a deleted expense", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    const input = dinner({
      payers: [{ memberId: Alice!, amountCents: 6000 }],
      split: { mode: "equal", memberIds: [Alice!, Bob!] },
    });

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input,
    });

    await deleteExpense({ expenseId, groupId });

    await expect(
      reviseExpense({ actorMemberId: Alice!, expenseId, groupId, input }),
    ).rejects.toThrow(/deleted/);
  });
});

describeDb("deleting an expense", () => {
  it("returns every member to where they were", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob", "Carol"]);
    const { Alice, Bob, Carol } = members;

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!, Carol!] },
      }),
    });

    await deleteExpense({ expenseId, groupId });

    expect(await nets(groupId, members)).toEqual({
      Alice: 0,
      Bob: 0,
      Carol: 0,
    });
    await expectHealthy(groupId);
  });

  it("is a no-op the second time", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    await deleteExpense({ expenseId, groupId });
    await deleteExpense({ expenseId, groupId });

    expect(await nets(groupId, members)).toEqual({ Alice: 0, Bob: 0 });
    await expectHealthy(groupId);
  });
});

describeDb("settlements", () => {
  const settle = async (args: {
    groupId: string;
    fromMemberId: string;
    toMemberId: string;
    amountCents: number;
  }) =>
    db.transaction(async (tx) => {
      const [settlement] = await tx
        .insert(Settlements)
        .values({
          amountCents: args.amountCents,
          createdByMemberId: args.fromMemberId,
          fromMemberId: args.fromMemberId,
          groupId: args.groupId,
          settledOn: "2026-08-04",
          toMemberId: args.toMemberId,
        })
        .returning({ id: Settlements.id });

      await postSettlement(tx, { ...args, settlementId: settlement!.id });

      return settlement!.id;
    });

  it("moves both parties in opposite directions", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        amountCents: 5000,
        payers: [{ memberId: Alice!, amountCents: 5000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    await settle({
      amountCents: 2500,
      fromMemberId: Bob!,
      groupId,
      toMemberId: Alice!,
    });

    expect(await nets(groupId, members)).toEqual({ Alice: 0, Bob: 0 });
    await expectHealthy(groupId);
  });

  it("flips the payer positive when they over-settle", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        amountCents: 5000,
        payers: [{ memberId: Alice!, amountCents: 5000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    await settle({
      amountCents: 4000,
      fromMemberId: Bob!,
      groupId,
      toMemberId: Alice!,
    });

    expect(await nets(groupId, members)).toEqual({ Alice: -1500, Bob: 1500 });
    await expectHealthy(groupId);
  });

  it("restores the prior balances when reversed", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        amountCents: 5000,
        payers: [{ memberId: Alice!, amountCents: 5000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    const settlementId = await settle({
      amountCents: 2500,
      fromMemberId: Bob!,
      groupId,
      toMemberId: Alice!,
    });

    await db.transaction(async (tx) => {
      await tx.execute(
        sql`update settlements set voided_at = now() where id = ${settlementId}`,
      );
      await reverseSettlement(tx, { groupId, settlementId });
    });

    expect(await nets(groupId, members)).toEqual({ Alice: 2500, Bob: -2500 });
    await expectHealthy(groupId);
  });

  it("leaves a new balance behind when an expense is revised after settling", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        amountCents: 5000,
        payers: [{ memberId: Alice!, amountCents: 5000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    await settle({
      amountCents: 2500,
      fromMemberId: Bob!,
      groupId,
      toMemberId: Alice!,
    });

    await reviseExpense({
      actorMemberId: Alice!,
      expenseId,
      groupId,
      input: dinner({
        amountCents: 6000,
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    expect(await nets(groupId, members)).toEqual({ Alice: 500, Bob: -500 });
    await expectHealthy(groupId);
  });
});

describeDb("concurrent revisions", () => {
  it("serializes on the expense row rather than corrupting the balance", async () => {
    const { groupId, members } = await scratch(["Alice", "Bob"]);
    const { Alice, Bob } = members;

    const { expenseId } = await createExpense({
      actorMemberId: Alice!,
      groupId,
      input: dinner({
        payers: [{ memberId: Alice!, amountCents: 6000 }],
        split: { mode: "equal", memberIds: [Alice!, Bob!] },
      }),
    });

    const revise = (amountCents: number) =>
      reviseExpense({
        actorMemberId: Alice!,
        expenseId,
        groupId,
        input: dinner({
          amountCents,
          payers: [{ memberId: Alice!, amountCents }],
          split: { mode: "equal", memberIds: [Alice!, Bob!] },
        }),
      });

    const outcomes = await Promise.allSettled([revise(7000), revise(8000)]);

    // Both are allowed to win — the second simply revises what the first left.
    // What must never happen is a double-reverse, a double-post, or two rows
    // claiming to be the same version: the first two break the zero-sum total,
    // and the third breaks the unique index on (expense_id, version).
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toEqual(
      [],
    );

    const [expense] = (
      await db.execute<{ current_version: number }>(
        sql`select current_version from expenses where id = ${expenseId}`,
      )
    ).rows;

    expect(expense?.current_version).toBe(3);
    await expectHealthy(groupId);
  });
});
