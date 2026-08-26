import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import db from "../../db";
import { dropScratchGroups } from "../../db/scratch";
import { GroupMembers, users } from "../../db/schema";
import { ensureGroup } from "../../lib/group";
import { getGroupImbalance } from "../../lib/ledger";
import { appRouter } from "../index";

/**
 * What the ledger suite cannot reach: the rules that live in the procedure
 * rather than in `postSettlement` — idempotency on a client-generated id, who
 * may claim a payment, and who may take one back.
 *
 * Opt-in on a live database, like every other integration suite here:
 *
 *   INTEGRATION_DATABASE_URL=postgresql://budget:budget@localhost:5432/budget pnpm --filter @budget/api test
 */
const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL);
const describeDb = enabled ? describe : describe.skip;

const STAMP = `settlements-test-${process.pid}`;
const groupIds: string[] = [];
const userIds: string[] = [];

type Caller = ReturnType<typeof appRouter.createCaller>;

const caller = (user: typeof users.$inferSelect): Caller =>
  appRouter.createCaller({
    user,
    // @ts-expect-error only `userId` is ever read off the session here.
    session: { id: "session", userId: user.id },
    resolveMember: ensureGroup,
  });

let owner: Caller;
let ownerMemberId: string;
let bobMemberId: string;
let groupId: string;

beforeAll(async () => {
  if (!enabled) return;

  const [user] = await db
    .insert(users)
    .values({
      email: `${STAMP}@example.com`,
      emailVerified: true,
      name: "",
    })
    .returning();

  if (!user) throw new Error("failed to create a scratch user");
  userIds.push(user.id);

  owner = caller(user);
  const group = await owner.groups.get();
  groupIds.push(group.id);

  groupId = group.id;
  ownerMemberId = group.myMemberId;

  // An unclaimed seat, which is payable: you can owe somebody who has never
  // opened the app.
  const [bob] = await db
    .insert(GroupMembers)
    .values({ displayName: "Bob", groupId, status: "invited" })
    .returning({ id: GroupMembers.id });

  if (!bob) throw new Error("failed to seat Bob");
  bobMemberId = bob.id;

  // $60, the owner paid, split evenly — so the owner is owed $30.
  await owner.expenses.create({
    amountCents: 6000,
    description: "Dinner",
    expenseDate: "2026-08-03",
    payers: [{ amountCents: 6000, memberId: ownerMemberId }],
    split: { memberIds: [ownerMemberId, bobMemberId], mode: "equal" },
  });
}, 30_000);

afterAll(async () => {
  if (!enabled) return;

  await dropScratchGroups(groupIds);
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
  await db.$client.end();
});

const netOf = async (memberId: string) => {
  const summary = await owner.balances.summary();

  return (
    summary.members.find((member) => member.id === memberId)?.netCents ?? 0
  );
};

describeDb("settlements.create", () => {
  it("refuses a payment to yourself", async () => {
    await expect(
      owner.settlements.create({
        amountCents: 1000,
        settledOn: "2026-08-04",
        settlementId: crypto.randomUUID(),
        toMemberId: ownerMemberId,
      }),
    ).rejects.toThrow(/settle up with yourself/i);
  });

  it("refuses a payment dated in the future", async () => {
    await expect(
      owner.settlements.create({
        amountCents: 1000,
        settledOn: "2099-01-01",
        settlementId: crypto.randomUUID(),
        toMemberId: bobMemberId,
      }),
    ).rejects.toThrow(/future/i);
  });

  it("records a payment once, however many times it is sent", async () => {
    const before = await netOf(ownerMemberId);
    const settlementId = crypto.randomUUID();

    const input = {
      amountCents: 1000,
      settledOn: "2026-08-04",
      settlementId,
      toMemberId: bobMemberId,
    };

    const first = await owner.settlements.create(input);
    // The replay a double-tap or a TanStack retry produces. It must move no
    // money and must not read as an error the client has to interpret.
    const replay = await owner.settlements.create(input);

    expect(first.created).toBe(true);
    expect(replay).toEqual({ created: false, settlementId });

    // The owner paid Bob, so the owner's position moves *up* by the amount:
    // positive means the group owes you, and paying somebody reduces what you
    // are owed.
    expect(await netOf(ownerMemberId)).toBe(before + 1000);
    expect(await getGroupImbalance(groupId)).toBe(0);
  });
});

describeDb("settlements.void", () => {
  it("puts the balances back and marks the row rather than hiding it", async () => {
    const before = await netOf(ownerMemberId);
    const settlementId = crypto.randomUUID();

    await owner.settlements.create({
      amountCents: 2500,
      settledOn: "2026-08-05",
      settlementId,
      toMemberId: bobMemberId,
    });

    await owner.settlements.void({ settlementId });

    const { items } = await owner.settlements.list({ limit: 50 });
    const voided = items.find((item) => item.id === settlementId);

    expect(voided?.voidedAt).not.toBeNull();
    expect(await netOf(ownerMemberId)).toBe(before);
    expect(await getGroupImbalance(groupId)).toBe(0);
  });

  it("refuses to void the same payment twice", async () => {
    const settlementId = crypto.randomUUID();

    await owner.settlements.create({
      amountCents: 500,
      settledOn: "2026-08-06",
      settlementId,
      toMemberId: bobMemberId,
    });

    await owner.settlements.void({ settlementId });

    await expect(owner.settlements.void({ settlementId })).rejects.toThrow(
      /already voided/i,
    );
  });

  it("refuses to void a payment that does not exist", async () => {
    await expect(
      owner.settlements.void({ settlementId: crypto.randomUUID() }),
    ).rejects.toThrow(/not found/i);
  });
});
