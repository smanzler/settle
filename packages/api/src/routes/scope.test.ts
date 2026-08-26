import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../db";
import { dropScratchGroups } from "../db/scratch";
import { users } from "../db/schema";
import { ensureGroup } from "../lib/group";
import { getGroupImbalance } from "../lib/ledger";
import { appRouter } from "./index";

/**
 * The leak test.
 *
 * Two groups are set up with real data, then every read is called as each user
 * and asserted to see none of the other's. It cannot be written against a mock —
 * the thing under test is whether a `WHERE` clause is actually present in the
 * SQL — so it is opt-in on a live database:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://budget:budget@localhost:25432/budget pnpm --filter @budget/api test
 *
 * Unlike a pure unit suite these cannot run inside a rolled-back transaction:
 * `createCaller` goes through the module-level `db`, which would not see
 * uncommitted rows. Everything they create is torn down in `afterAll`.
 */
const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL);
const describeDb = enabled ? describe : describe.skip;

const STAMP = `scope-test-${process.pid}`;
const groupIds: string[] = [];
const userIds: string[] = [];

type User = typeof users.$inferSelect;

const caller = (user: User) =>
  appRouter.createCaller({
    user,
    // @ts-expect-error only `userId` is ever read off the session here, and
    // `req`/`res` are never touched by a procedure.
    session: { id: "session", userId: user.id },
    // One caller is one request, so the real per-request memo would be a no-op
    // here — every call goes through the same lookup the middleware makes.
    resolveMember: ensureGroup,
  });

/** A user with a group of their own and one $60 expense in it. */
const setUpGroup = async (label: string) => {
  const [user] = await db
    .insert(users)
    .values({
      email: `${STAMP}-${label}@example.com`,
      emailVerified: true,
      name: "",
    })
    .returning();

  if (!user) throw new Error("failed to create a scratch user");
  userIds.push(user.id);

  const api = caller(user);
  const group = await api.groups.get();
  groupIds.push(group.id);

  const expense = await api.expenses.create({
    amountCents: 6000,
    description: `${label} dinner`,
    expenseDate: "2026-08-03",
    payers: [{ memberId: group.myMemberId, amountCents: 6000 }],
    split: { mode: "equal", memberIds: [group.myMemberId] },
  });

  return { api, expense, group, user };
};

let alice: Awaited<ReturnType<typeof setUpGroup>>;
let bob: Awaited<ReturnType<typeof setUpGroup>>;

beforeAll(async () => {
  if (!enabled) return;

  alice = await setUpGroup("alice");
  bob = await setUpGroup("bob");
}, 30_000);

afterAll(async () => {
  if (!enabled) return;

  await dropScratchGroups(groupIds);
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
  await db.$client.end();
});

describeDb("group scope", () => {
  it("shows each caller only their own expenses", async () => {
    const [mine, theirs] = await Promise.all([
      alice.api.expenses.list(),
      bob.api.expenses.list(),
    ]);

    expect(mine.items.map((item) => item.id)).toEqual([
      alice.expense.expenseId,
    ]);
    expect(theirs.items.map((item) => item.id)).toEqual([
      bob.expense.expenseId,
    ]);
  });

  it("refuses to read another group's expense by id", async () => {
    await expect(
      alice.api.expenses.get({ expenseId: bob.expense.expenseId }),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses to read another group's revision history", async () => {
    await expect(
      alice.api.expenses.history({ expenseId: bob.expense.expenseId }),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses to delete another group's expense", async () => {
    await expect(
      alice.api.expenses.delete({ expenseId: bob.expense.expenseId }),
    ).rejects.toThrow(/not found/i);
  });

  it("refuses an expense that names a member of another group", async () => {
    await expect(
      alice.api.expenses.create({
        amountCents: 5000,
        description: "Not yours",
        expenseDate: "2026-08-03",
        payers: [{ memberId: alice.group.myMemberId, amountCents: 5000 }],
        split: { mode: "equal", memberIds: [bob.group.myMemberId] },
      }),
    ).rejects.toThrow(/not a member of the group/i);
  });

  it("refuses a payer from another group", async () => {
    await expect(
      alice.api.expenses.create({
        amountCents: 5000,
        description: "Not yours",
        expenseDate: "2026-08-03",
        payers: [{ memberId: bob.group.myMemberId, amountCents: 5000 }],
        split: { mode: "equal", memberIds: [alice.group.myMemberId] },
      }),
    ).rejects.toThrow(/not a member of the group/i);
  });

  it("refuses a settlement paid to a member of another group", async () => {
    await expect(
      alice.api.settlements.create({
        amountCents: 1000,
        settledOn: "2026-08-03",
        settlementId: crypto.randomUUID(),
        toMemberId: bob.group.myMemberId,
      }),
    ).rejects.toThrow(/member not found/i);
  });

  it("refuses to switch into a group the caller is not in", async () => {
    await expect(
      alice.api.groups.setActive({ groupId: bob.group.id }),
    ).rejects.toThrow(/not a member/i);
  });

  it("shows each caller only their own members on the balances screen", async () => {
    const summary = await alice.api.balances.summary();

    expect(summary.members.map((row) => row.id)).toEqual([
      alice.group.myMemberId,
    ]);
  });

  it("keeps each group's ledger internally consistent", async () => {
    for (const group of [alice.group, bob.group]) {
      expect(await getGroupImbalance(group.id)).toBe(0);
    }
  });
});
