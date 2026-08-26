import { sql } from "drizzle-orm";
import db from "./index";
import { GroupMembers, Groups } from "./schema";

/**
 * Test-only support for the integration suites.
 *
 * The ledger operations open their own transactions against the module-level
 * `db`, so a test cannot wrap them in one and roll it back — the work has to
 * commit to be observable. These suites create a real group instead and drop it
 * afterwards, which keeps a development database usable as the target.
 */
export const createScratchGroup = async (args: {
  name: string;
  memberNames: readonly string[];
}) => {
  const [group] = await db
    .insert(Groups)
    .values({ isoCurrencyCode: "USD", name: args.name })
    .returning({ id: Groups.id });

  if (!group) throw new Error("failed to create a scratch group");

  const members = await db
    .insert(GroupMembers)
    .values(
      args.memberNames.map((displayName) => ({
        displayName,
        groupId: group.id,
        status: "active" as const,
      })),
    )
    .returning({ displayName: GroupMembers.displayName, id: GroupMembers.id });

  return {
    groupId: group.id,
    members: Object.fromEntries(
      members.map((member) => [member.displayName, member.id]),
    ) as Record<string, string>,
  };
};

/**
 * Removes scratch groups and everything hanging off them.
 *
 * The append-only triggers are the one thing in the way, and they are turned off
 * for exactly this statement. **This is the only sanctioned bypass, and it exists
 * so tests can clean up after themselves** — the triggers are themselves under
 * test, in `ledger.test.ts`, which asserts that a direct UPDATE and a direct
 * DELETE both raise.
 */
export const dropScratchGroups = async (groupIds: readonly string[]) => {
  if (groupIds.length === 0) return;

  const ids = sql`(${sql.join(
    groupIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;

  await db.execute(sql`alter table ledger_entries disable trigger user`);

  try {
    await db.execute(sql`delete from ledger_entries where group_id in ${ids}`);
  } finally {
    await db.execute(sql`alter table ledger_entries enable trigger user`);
  }

  // In dependency order, because every reference to a member seat is NO ACTION:
  // dropping the group cascades the seats away, and anything still pointing at
  // one refuses. Expenses cascade to their versions, payers and shares.
  await db.execute(sql`delete from settlements where group_id in ${ids}`);
  await db.execute(sql`delete from expenses where group_id in ${ids}`);
  await db.execute(sql`delete from group_invites where group_id in ${ids}`);
  await db.execute(sql`delete from groups where id in ${ids}`);
};
