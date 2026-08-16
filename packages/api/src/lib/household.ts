import { and, eq, isNull, or, sql } from "drizzle-orm";
import db from "../db";
import { HouseholdMembers, Households, UserHouseholdPrefs } from "../db/schema";

/**
 * The one spelling of an email address the app compares against.
 *
 * Invite acceptance authorizes on this comparison, so both sides of it have to
 * normalize the same way.
 */
export const toNormalizedEmail = (email: string) => email.trim().toLowerCase();

/**
 * Whether the household has ever posted to the ledger — the test that locks its
 * currency, because a posted entry carries one and nothing re-denominates it.
 */
export const hasPostedEntries = async (householdId: string) => {
  const posted = await db.query.LedgerEntries.findFirst({
    where: { householdId },
    columns: { id: true },
  });

  return posted !== undefined;
};

/** The seat a request acts as. Resolved from the session, never from input. */
export type Member = typeof HouseholdMembers.$inferSelect;

/**
 * better-auth's emailOTP writes `name || ""`, and the verify screen never sends
 * one, so `users.name` is empty for every user this app creates. Falling back
 * to the local part of the email is the difference between a members list that
 * reads "simanzler" and one that reads "".
 */
export const memberDisplayName = (user: {
  name?: string | null;
  email: string;
}) => user.name?.trim() || user.email.split("@")[0] || "Member";

/**
 * The household a user acts in, creating it on first use.
 *
 * Called from two places on purpose. The better-auth signup hook covers real
 * sign-ups, and `householdProcedure` covers everything else — `db/seed.ts`
 * writes users through drizzle-seed and bypasses better-auth entirely, so a
 * hook-only bootstrap would leave every seeded user permanently 403ing.
 *
 * Idempotent under concurrency: two simultaneous first requests both hit the
 * unique index on `households.created_by_user_id`, and the loser reads back the
 * winner's row instead of failing.
 */
export const ensureHousehold = async (user: {
  id: string;
  name?: string | null;
  email: string;
}): Promise<Member> => {
  const existing = await resolveActiveMember(user.id);
  if (existing) return existing;

  return bootstrapHousehold(user);
};

/**
 * The seat a user acts as, out of however many they hold.
 *
 * Their stored preference first, then their oldest active seat. The fallback is
 * not a nicety: the preference can point at a household they have since left, or
 * one that has been deleted, and either has to degrade to a working session
 * rather than a 404 on every screen.
 *
 * Notice what the preference is checked against — an **active seat in that
 * household for this user**. That is why storing it is not an authorization
 * decision: a stale or tampered value selects nothing and falls through.
 */
export const resolveActiveMember = async (
  userId: string,
): Promise<Member | undefined> => {
  const pref = await db.query.UserHouseholdPrefs.findFirst({
    where: { userId },
    columns: { activeHouseholdId: true },
  });

  if (pref?.activeHouseholdId) {
    const preferred = await db.query.HouseholdMembers.findFirst({
      where: {
        userId,
        status: "active",
        householdId: pref.activeHouseholdId,
      },
    });

    if (preferred) return preferred;
  }

  return db.query.HouseholdMembers.findFirst({
    where: { userId, status: "active" },
    // Deterministic, so a user with several seats and no preference does not
    // silently flip between households from one request to the next.
    orderBy: { createdAt: "asc" },
  });
};

/**
 * Gives a user with no active seat anywhere a household of their own.
 *
 * Always a **fresh** household, never a revived seat in the one they made
 * first. Reviving used to be safe under the single-household assertion — "this
 * household is by definition the one this user created, so the seat is their
 * own" — and stopped being safe the moment `leave` existed: the household they
 * created can now belong to other people, and flipping their retired seat back
 * to `active` would restore `role: 'owner'` over it, handing back `rename`,
 * `removeMember`, `setAccountOwner` and account privacy to somebody who left.
 *
 * Idempotent under concurrency by advisory lock rather than by a unique index on
 * `households.created_by_user_id`, which is the constraint that forced the
 * revive: it capped a user at one household ever created. The lock gives the
 * same guarantee — two simultaneous first requests, one household — without
 * capping anything.
 */
const bootstrapHousehold = (user: {
  id: string;
  name?: string | null;
  email: string;
}): Promise<Member> => {
  const displayName = memberDisplayName(user);

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`household-bootstrap:${user.id}`}, 0))`,
    );

    // Re-read inside the lock. The loser of a race must adopt the winner's
    // household instead of creating a second one, and this is the only place
    // that can tell the difference.
    const raced = await tx.query.HouseholdMembers.findFirst({
      where: { userId: user.id, status: "active" },
      orderBy: { createdAt: "asc" },
    });

    if (raced) return raced;

    const [household] = await tx
      .insert(Households)
      .values({
        name: `${displayName}'s household`,
        createdByUserId: user.id,
      })
      .returning({ id: Households.id });

    if (!household) {
      throw new Error(`failed to bootstrap a household for user ${user.id}`);
    }

    const [member] = await tx
      .insert(HouseholdMembers)
      .values({
        householdId: household.id,
        userId: user.id,
        displayName,
        role: "owner",
        status: "active",
        joinedAt: new Date(),
      })
      .returning();

    if (!member) {
      throw new Error(`failed to bootstrap a member seat for user ${user.id}`);
    }

    return member;
  });
};

/**
 * Points a user at a household. Call only after proving they hold an active seat
 * in it — this writes a preference, it does not check one.
 */
export const setActiveHousehold = ({
  householdId,
  tx,
  userId,
}: {
  householdId: string | null;
  tx: Pick<typeof db, "insert">;
  userId: string;
}) =>
  tx
    .insert(UserHouseholdPrefs)
    .values({ userId, activeHouseholdId: householdId })
    .onConflictDoUpdate({
      target: UserHouseholdPrefs.userId,
      set: { activeHouseholdId: householdId, updatedAt: new Date() },
    });

/** A member as the clients see one, on a split, a balance or an activity row. */
export type MemberRef = {
  id: string;
  displayName: string;
  isYou: boolean;
  status: "invited" | "active" | "removed";
};

/**
 * Shapes a member for the wire, tolerating one that is no longer there.
 *
 * Every id the ledger and the splits reference must render with a name, and a
 * seat can be removed after it earned history — so the lookup is allowed to
 * miss, and the fallback is stated once here rather than at each call site.
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

/**
 * Members who can be assigned a share. `invited` seats count: the whole point
 * of a seat existing before its invite is accepted is that you can split with
 * that person today. `removed` seats do not — their history stays in the
 * ledger, but nothing new accrues to them.
 */
export const splittableMembers = (householdId: string) =>
  db
    .select()
    .from(HouseholdMembers)
    .where(
      and(
        eq(HouseholdMembers.householdId, householdId),
        or(
          eq(HouseholdMembers.status, "active"),
          eq(HouseholdMembers.status, "invited"),
        ),
        isNull(HouseholdMembers.removedAt),
      ),
    )
    .orderBy(HouseholdMembers.createdAt);
