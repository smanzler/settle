import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import db from "../../db";
import { dropScratchGroups } from "../../db/scratch";
import { users } from "../../db/schema";
import { createExpense } from "../../lib/expenses";
import { ensureGroup } from "../../lib/group";
import { listGroupBalances } from "../../lib/ledger";
import { appRouter } from "../index";

/**
 * Membership rules that only show up against a real database: a partial unique
 * index, an advisory lock, and a guard that has to count seats nobody has
 * claimed yet.
 *
 *   INTEGRATION_DATABASE_URL=postgresql://budget:budget@localhost:5432/budget pnpm --filter @budget/api test
 */
const enabled = Boolean(process.env.INTEGRATION_DATABASE_URL);
const describeDb = enabled ? describe : describe.skip;

const STAMP = `groups-test-${process.pid}`;
const groupIds: string[] = [];
const userIds: string[] = [];

let counter = 0;

type Caller = ReturnType<typeof appRouter.createCaller>;

const makeUser = async (): Promise<{ caller: Caller; email: string }> => {
  const email = `${STAMP}-${(counter += 1)}@example.com`;

  const [user] = await db
    .insert(users)
    .values({ email, emailVerified: true, name: "" })
    .returning();

  if (!user) throw new Error("failed to create a scratch user");
  userIds.push(user.id);

  return {
    caller: appRouter.createCaller({
      user,
      // @ts-expect-error only `userId` is ever read off the session here.
      session: { id: "session", userId: user.id },
      resolveMember: ensureGroup,
    }),
    email,
  };
};

/** An owner with a group of their own, tracked for teardown. */
const makeOwner = async () => {
  const { caller, email } = await makeUser();
  const group = await caller.groups.get();
  groupIds.push(group.id);

  return { caller, email, group };
};

afterAll(async () => {
  if (!enabled) return;

  await dropScratchGroups(groupIds);
  if (userIds.length > 0) {
    await db.delete(users).where(inArray(users.id, userIds));
  }
  await db.$client.end();
});

describeDb("rejoining after removal", () => {
  it("lets somebody who was removed accept a fresh invite", async () => {
    const alice = await makeOwner();
    const bob = await makeUser();

    const first = await alice.caller.groups.invite({
      displayName: "Bob",
      email: bob.email,
    });
    await bob.caller.groups.acceptInvite({ code: first.code });

    await alice.caller.groups.removeMember({ memberId: first.memberId });

    // The retired seat keeps its `user_id` forever, because the ledger names it
    // and its history has to keep reading correctly. A plain unique constraint
    // on (group, user) would make this second acceptance a raw constraint
    // violation with no way back; the index is partial for exactly this.
    const second = await alice.caller.groups.invite({
      displayName: "Bob",
      email: bob.email,
    });
    const rejoined = await bob.caller.groups.acceptInvite({
      code: second.code,
    });

    expect(rejoined.groupId).toBe(alice.group.id);
    expect(rejoined.memberId).not.toBe(first.memberId);

    const members = await alice.caller.groups.get();
    const live = members.members.filter((seat) => seat.status !== "removed");

    expect(live.map((seat) => seat.displayName).sort()).toEqual([
      "Bob",
      members.members.find((seat) => seat.isYou)?.displayName,
    ]);
  });
});

describeDb("leaving", () => {
  it("refuses while the only other seats are unclaimed invites", async () => {
    const alice = await makeOwner();

    await alice.caller.groups.invite({
      displayName: "Carol",
      email: `${STAMP}-carol@example.com`,
    });

    // Carol can still accept, and would land in a group with no owner —
    // `transferOwnership` cannot hand the role to a seat with no user behind it.
    await expect(alice.caller.groups.leave()).rejects.toThrow(
      /nobody has accepted their invite yet/i,
    );
  });

  it("allows the last seat in a group to leave", async () => {
    const alice = await makeOwner();

    await expect(alice.caller.groups.leave()).resolves.toMatchObject({
      groupId: alice.group.id,
    });
  });
});

describeDb("invite visibility", () => {
  it("refuses to list invites to an ordinary member", async () => {
    const alice = await makeOwner();
    const bob = await makeUser();

    const invite = await alice.caller.groups.invite({
      displayName: "Bob",
      email: bob.email,
    });
    await bob.caller.groups.acceptInvite({ code: invite.code });

    // The rows carry the invitee's address and the code itself.
    await expect(bob.caller.groups.invites.list()).rejects.toThrow(
      /only the group owner/i,
    );
    await expect(alice.caller.groups.invites.list()).resolves.toBeInstanceOf(
      Array,
    );
  });
});

describeDb("removing a member while an expense is posting", () => {
  it("never strands a balance on the retired seat", async () => {
    const alice = await makeOwner();
    const bob = await makeUser();

    const invite = await alice.caller.groups.invite({
      displayName: "Bob",
      email: bob.email,
    });
    await bob.caller.groups.acceptInvite({ code: invite.code });

    const me = alice.group.myMemberId;

    // Both writers take `lockGroup`, so one of two things happens: the expense
    // commits first and the removal refuses (Bob owes something) or writes it
    // off, or the removal commits first and the expense is refused for naming a
    // retired seat. What must never happen is a removed seat left owing money —
    // no procedure can settle that, and every integrity check calls it healthy.
    const outcomes = await Promise.allSettled([
      createExpense({
        actorMemberId: me,
        groupId: alice.group.id,
        input: {
          amountCents: 1000,
          description: "Coffee",
          expenseDate: "2026-08-03",
          payers: [{ amountCents: 1000, memberId: me }],
          split: { memberIds: [me, invite.memberId], mode: "equal" },
        },
      }),
      alice.caller.groups.removeMember({
        memberId: invite.memberId,
        writeOffBalance: true,
      }),
    ]);

    expect(outcomes.some((outcome) => outcome.status === "fulfilled")).toBe(
      true,
    );

    const balances = await listGroupBalances(alice.group.id);
    const seats = await alice.caller.groups.get();

    for (const balance of balances) {
      const seat = seats.members.find((row) => row.id === balance.memberId);
      if (seat?.status !== "removed") continue;

      expect(balance.netCents).toBe(0);
    }

    expect(await alice.caller.balances.verify()).toEqual({
      drift: [],
      imbalance: 0,
    });
  });
});
