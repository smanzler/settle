import { sql } from "drizzle-orm";
import db from "../db";
import { GroupMembers, Groups, UserGroupPrefs } from "../db/schema";
import type { Tx } from "./ledger";

/**
 * The one spelling of an email address the app compares against.
 *
 * Invite acceptance authorizes on this comparison, so both sides of it have to
 * normalize the same way.
 */
export const toNormalizedEmail = (email: string) => email.trim().toLowerCase();

/** The seat a request acts as. Resolved from the session, never from input. */
export type Member = typeof GroupMembers.$inferSelect;

/**
 * better-auth's emailOTP writes `name || ""`, and the verify screen never sends
 * one, so `users.name` is empty for every user this app creates. Falling back to
 * the local part of the email is the difference between a members list that
 * reads "simanzler" and one that reads "".
 */
export const memberDisplayName = (user: {
  name?: string | null;
  email: string;
}) => user.name?.trim() || user.email.split("@")[0] || "Member";

type NewUser = { id: string; name?: string | null; email: string };

/**
 * A group with its creator seated in it as owner.
 *
 * Takes a transaction handle rather than opening one: the two callers both have
 * more to do in the same transaction — bootstrap re-reads under a lock first,
 * `groups.create` sets the new group active afterwards.
 */
export const createGroup = async (
  tx: Tx,
  args: {
    createdByUserId: string;
    displayName: string;
    /** Fixed for the life of the group. Defaults to the column default. */
    isoCurrencyCode?: string | undefined;
    name: string;
  },
): Promise<Member> => {
  const [group] = await tx
    .insert(Groups)
    .values({
      createdByUserId: args.createdByUserId,
      isoCurrencyCode: args.isoCurrencyCode,
      name: args.name,
    })
    .returning({ id: Groups.id });

  if (!group) throw new Error(`failed to create a group named ${args.name}`);

  const [member] = await tx
    .insert(GroupMembers)
    .values({
      displayName: args.displayName,
      groupId: group.id,
      joinedAt: new Date(),
      role: "owner",
      status: "active",
      userId: args.createdByUserId,
    })
    .returning();

  if (!member) throw new Error(`failed to seat the owner of group ${group.id}`);

  return member;
};

/**
 * The group a user acts in, creating one on first use.
 *
 * Called from two places on purpose. The better-auth signup hook covers real
 * sign-ups, and `groupProcedure` covers everything else — `db/seed.ts` writes
 * users through drizzle-seed and bypasses better-auth entirely, so a hook-only
 * bootstrap would leave every seeded user permanently 403ing.
 */
export const ensureGroup = async (user: NewUser): Promise<Member> => {
  const existing = await resolveActiveMember(user.id);
  if (existing) return existing;

  return bootstrapGroup(user);
};

/**
 * The seat a user acts as, out of however many they hold.
 *
 * Their stored preference first, then their oldest active seat. The fallback is
 * not a nicety: the preference can point at a group they have since left, and
 * that has to degrade to a working session rather than a 404 on every screen.
 *
 * Notice what the preference is checked against — an **active seat in that group
 * for this user**. That is why storing it is not an authorization decision: a
 * stale or tampered value selects nothing and falls through.
 */
export const resolveActiveMember = async (
  userId: string,
): Promise<Member | undefined> => {
  const pref = await db.query.UserGroupPrefs.findFirst({
    where: { userId },
    columns: { activeGroupId: true },
  });

  if (pref?.activeGroupId) {
    const preferred = await db.query.GroupMembers.findFirst({
      where: { userId, status: "active", groupId: pref.activeGroupId },
    });

    if (preferred) return preferred;
  }

  return db.query.GroupMembers.findFirst({
    where: { userId, status: "active" },
    // Deterministic, so a user with several seats and no preference does not
    // silently flip between groups from one request to the next.
    orderBy: { createdAt: "asc" },
  });
};

/**
 * Gives a user with no active seat anywhere a group of their own.
 *
 * Always a **fresh** group, never a revived seat in one they left: flipping a
 * retired seat back to `active` would restore `role: 'owner'` over a group that
 * now belongs to other people.
 *
 * Idempotent under concurrency by advisory lock. Two simultaneous first requests
 * take turns, and the loser re-reads the winner's seat instead of creating a
 * second group.
 */
const bootstrapGroup = (user: NewUser): Promise<Member> => {
  const displayName = memberDisplayName(user);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`group-bootstrap:${user.id}`}, 0))`,
    );

    const raced = await tx.query.GroupMembers.findFirst({
      where: { userId: user.id, status: "active" },
      orderBy: { createdAt: "asc" },
    });

    if (raced) return raced;

    return createGroup(tx, {
      createdByUserId: user.id,
      displayName,
      name: `${displayName}'s group`,
    });
  });
};

/**
 * Points a user at a group. Call only after proving they hold an active seat in
 * it — this writes a preference, it does not check one.
 */
export const setActiveGroup = ({
  groupId,
  tx,
  userId,
}: {
  groupId: string | null;
  tx: Pick<typeof db, "insert">;
  userId: string;
}) =>
  tx
    .insert(UserGroupPrefs)
    .values({ activeGroupId: groupId, userId })
    .onConflictDoUpdate({
      target: UserGroupPrefs.userId,
      set: { activeGroupId: groupId, updatedAt: new Date() },
    });

/** A member as the clients see one, on a split, a balance or an expense row. */
export type MemberRef = {
  id: string;
  displayName: string;
  isYou: boolean;
  status: "invited" | "active" | "removed";
};

/**
 * Shapes a member for the wire, tolerating one that is no longer there.
 *
 * Every id the ledger references must render with a name, and a seat can be
 * removed after it earned history — so the lookup is allowed to miss, and the
 * fallback is stated once here rather than at each call site.
 */
export const toMemberRef = ({
  fallbackId,
  member,
  youId,
}: {
  fallbackId: string;
  member:
    | { id: string; displayName: string; status: MemberRef["status"] }
    | undefined;
  youId: string;
}): MemberRef => ({
  id: member?.id ?? fallbackId,
  // A removed seat still owns history, so it must still render with a name.
  displayName: member?.displayName ?? "Former member",
  isYou: (member?.id ?? fallbackId) === youId,
  status: member?.status ?? "removed",
});
