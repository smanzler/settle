import { sql } from "drizzle-orm";
import db from "../db";
import { LedgerEntries } from "../db/schema";

/** The Drizzle transaction handle, as `db.transaction` hands it to a callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Anything that can run a statement — the pool, or one transaction on it. */
export type Executor = Pick<typeof db, "execute"> | Tx;

/**
 * A member's net position, signed the way the ledger stores it: **positive means
 * the group owes them; negative means they owe the group.**
 */
export type Balance = { memberId: string; netCents: number };

type PendingEntry = typeof LedgerEntries.$inferInsert;

/**
 * Every event sums to zero — checked in the application layer, because nothing
 * in the database can express it.
 *
 * The database cannot express "these rows, together, sum to zero" — a CHECK is
 * per row and a trigger cannot see a whole statement's worth of inserts. So the
 * invariant that every other guarantee rests on is asserted here, on every
 * single write path, and the group-wide sum in `assertGroupIntegrity` is the
 * independent check that it was never skipped.
 */
const assertZeroSum = (entries: readonly PendingEntry[], context: string) => {
  const total = entries.reduce((sum, entry) => sum + entry.amountCents, 0);

  if (total !== 0) {
    throw new Error(`ledger event does not sum to zero (${context}): ${total}`);
  }
};

/**
 * Reads an expense's mutable head under a row lock, for a caller that is about
 * to revise or delete it.
 *
 * `reviseExpense` is reverse-then-post, and Drizzle runs at READ COMMITTED, so
 * two concurrent revisions would both read the same `current_version`, both
 * reverse it, and both post a new one — a silently doubled balance and two rows
 * claiming to be version N+1. `lockGroup` already excludes the second writer;
 * `FOR UPDATE` is the narrower guarantee stated where it is relied on, so this
 * stays correct on its own terms if a future caller reaches it directly.
 *
 * Returns `undefined` for an expense that is not in this group, which is the
 * not-found answer every caller wants.
 */
export const lockExpense = async (
  tx: Tx,
  args: { expenseId: string; groupId: string },
) => {
  const locked = await tx.execute<{
    id: string;
    current_version: number;
    deleted_at: Date | null;
  }>(sql`
    select id, current_version, deleted_at
    from expenses
    where id = ${args.expenseId} and group_id = ${args.groupId}
    for update
  `);

  const [row] = locked.rows;

  return row
    ? {
        id: row.id,
        currentVersion: row.current_version,
        deletedAt: row.deleted_at,
      }
    : undefined;
};

/**
 * Serializes every writer in one group, and **must be the first statement** of
 * any transaction that appends to the ledger.
 *
 * An advisory lock only excludes other holders of the same advisory lock, so a
 * writer that skips this is invisible to every writer that takes it. That is not
 * a theoretical gap: `retireSeat` decides what to write by reading the balances,
 * and an expense committing between its read and its write strands a debt on a
 * seat that has just been retired — a state no procedure can settle, and one
 * that both `assertGroupIntegrity` and `verifyLedger` call healthy, because an
 * expense is itself zero-sum and the documents and the ledger agree.
 *
 * Group-wide rather than per-expense because the write-off's read spans the
 * whole group. Write volume here is a few rows per household per day, so
 * serializing all of it costs nothing worth measuring.
 *
 * Taken before any row lock, everywhere, so the lock order cannot deadlock.
 */
export const lockGroup = (tx: Tx, groupId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${groupId}, 0))`,
  );

/**
 * Posts an expense version: one `paid` entry per payer, one `share` entry per
 * participant.
 *
 * `+A` from the payers and `-A` from the shares, so the set sums to zero by
 * construction. A member who both paid and consumed gets one of each rather than
 * a netted single row — the two facts are separately true, and the revision
 * history has to be able to state them separately.
 */
export const postExpenseVersion = async (
  tx: Tx,
  args: {
    groupId: string;
    expenseId: string;
    version: number;
    payers: readonly { memberId: string; amountCents: number }[];
    shares: readonly { memberId: string; amountCents: number }[];
  },
) => {
  const common = {
    groupId: args.groupId,
    sourceType: "expense" as const,
    sourceId: args.expenseId,
    sourceVersion: args.version,
  };

  const entries: PendingEntry[] = [
    ...args.payers.map((payer) => ({
      ...common,
      memberId: payer.memberId,
      amountCents: payer.amountCents,
      entryType: "paid" as const,
    })),
    ...args.shares
      // A zero share is a real statement about a participant and a non-statement
      // about money. The CHECK on the column refuses it; dropping it here is
      // what makes the CHECK enforceable rather than an obstacle.
      .filter((share) => share.amountCents !== 0)
      .map((share) => ({
        ...common,
        memberId: share.memberId,
        amountCents: -share.amountCents,
        entryType: "share" as const,
      })),
  ];

  assertZeroSum(entries, `expense ${args.expenseId} v${args.version}`);

  await tx.insert(LedgerEntries).values(entries);
};

/**
 * Negates every entry posted for one expense version, linking each reversal to
 * the row it undoes.
 *
 * One statement, deliberately: read-then-insert would let two callers reverse
 * the same version twice, and the whole point of an append-only ledger is that
 * there is no way back from that. The `not exists` skips anything already
 * reversed, and `ledger_entries_reverses_unique` turns a race that slipped past
 * it into an error instead of a doubled balance.
 *
 * The negation of a zero-sum set is a zero-sum set, so the event still sums to
 * zero — and that is checked against what was written rather than assumed.
 */
export const reverseExpenseVersion = async (
  tx: Tx,
  args: { groupId: string; expenseId: string; version: number },
) =>
  reverse(tx, {
    groupId: args.groupId,
    sourceType: "expense",
    sourceId: args.expenseId,
    sourceVersion: args.version,
    context: `expense ${args.expenseId} v${args.version}`,
  });

/**
 * Records a repayment. Bob pays Alice $25: Bob `+2500`, Alice `-2500`.
 *
 * Reads oddly until the sign convention is in hand — positive means the group
 * owes you. Bob owed, so paying moves him *up* toward zero; Alice was owed, so
 * being paid moves her *down* toward zero.
 */
export const postSettlement = async (
  tx: Tx,
  args: {
    groupId: string;
    settlementId: string;
    fromMemberId: string;
    toMemberId: string;
    amountCents: number;
  },
) => {
  const common = {
    entryType: "settlement" as const,
    groupId: args.groupId,
    sourceId: args.settlementId,
    sourceType: "settlement" as const,
  };

  const entries: PendingEntry[] = [
    { ...common, amountCents: args.amountCents, memberId: args.fromMemberId },
    { ...common, amountCents: -args.amountCents, memberId: args.toMemberId },
  ];

  assertZeroSum(entries, `settlement ${args.settlementId}`);

  await tx.insert(LedgerEntries).values(entries);
};

export const reverseSettlement = (
  tx: Tx,
  args: { groupId: string; settlementId: string },
) =>
  reverse(tx, {
    groupId: args.groupId,
    sourceType: "settlement",
    sourceId: args.settlementId,
    sourceVersion: 1,
    context: `settlement ${args.settlementId}`,
  });

const reverse = async (
  tx: Tx,
  args: {
    groupId: string;
    sourceType: "expense" | "settlement";
    sourceId: string;
    sourceVersion: number;
    context: string;
  },
) => {
  const reversed = await tx.execute<{ amount_cents: string }>(sql`
    insert into ledger_entries (
      group_id, member_id, amount_cents, entry_type,
      source_type, source_id, source_version, reverses_id
    )
    select e.group_id, e.member_id, -e.amount_cents, e.entry_type,
           e.source_type, e.source_id, e.source_version, e.id
    from ledger_entries e
    where e.group_id = ${args.groupId}
      and e.source_type = ${args.sourceType}
      and e.source_id = ${args.sourceId}
      and e.source_version = ${args.sourceVersion}
      -- Never reverse a reversal, and never reverse the same entry twice.
      and e.reverses_id is null
      and not exists (
        select 1 from ledger_entries r where r.reverses_id = e.id
      )
    returning amount_cents::text
  `);

  // `bigint` arrives from node-postgres as a string, never a number.
  const total = reversed.rows.reduce(
    (sum, row) => sum + Number(row.amount_cents),
    0,
  );

  if (total !== 0) {
    throw new Error(
      `reversal does not sum to zero (${args.context}): ${total}`,
    );
  }

  return reversed.rows.length;
};

/**
 * Every member's net position. This is the whole balance feature.
 *
 * Derived on every read, never stored — there is no "since last settlement"
 * window and no period close, because a settlement is simply more entries.
 * Removed seats are included: they can still be owed, and a balance that hid
 * them would not add up.
 */
export const listGroupBalances = async (
  groupId: string,
  executor: Executor = db,
): Promise<(Balance & { displayName: string; status: string })[]> => {
  const rows = await executor.execute<{
    member_id: string;
    display_name: string;
    status: string;
    net_cents: string;
  }>(sql`
    select gm.id                                as member_id,
           gm.display_name                      as display_name,
           gm.status::text                      as status,
           coalesce(sum(le.amount_cents), 0)::text as net_cents
    from group_members gm
    left join ledger_entries le
      on le.member_id = gm.id and le.group_id = gm.group_id
    where gm.group_id = ${groupId}
    group by gm.id, gm.display_name, gm.status, gm.created_at
    order by coalesce(sum(le.amount_cents), 0) desc, gm.created_at asc
  `);

  return rows.rows.map((row) => ({
    displayName: row.display_name,
    memberId: row.member_id,
    netCents: Number(row.net_cents),
    status: row.status,
  }));
};

/**
 * The canary: the signed total across a whole group, which is `0` at every
 * moment for every group that has ever existed.
 *
 * Anything else means a logical event was posted without its counterpart, and
 * it is the only symptom that shows up before somebody's balance is quietly
 * wrong. Cheap enough to run on every write and in every test.
 */
export const getGroupImbalance = async (
  groupId: string,
  executor: Executor = db,
) => {
  const rows = await executor.execute<{ imbalance: string }>(sql`
    select coalesce(sum(amount_cents), 0)::text as imbalance
    from ledger_entries
    where group_id = ${groupId}
  `);

  return Number(rows.rows[0]?.imbalance ?? 0);
};

/** The same check, as the last thing a write transaction does before it commits. */
export const assertGroupIntegrity = async (tx: Tx, groupId: string) => {
  const imbalance = await getGroupImbalance(groupId, tx);

  if (imbalance !== 0) {
    throw new Error(
      `group ${groupId} ledger does not sum to zero: ${imbalance}`,
    );
  }
};

/**
 * The insurance an append-only projection otherwise lacks.
 *
 * `ledger_entries` is only correct if no post or reversal was ever missed.
 * `assertGroupIntegrity` catches a *lopsided* event; this catches an event that
 * was skipped or double-posted symmetrically, which sums to zero and is
 * therefore invisible to it.
 *
 * Recomputes each member's position from the documents themselves — the current
 * version of every live expense, plus every settlement that has not been voided
 * — and reports whoever disagrees. Read-only, and milliseconds at this scale:
 * run it in tests, expose it to the group owner, and put it on a nightly job.
 */
export const verifyLedger = async (
  groupId: string,
  /**
   * Defaults to a fresh connection because the procedure exposing this is a
   * plain query. Pass a transaction handle to check work that has not committed
   * yet — otherwise this reads the pre-transaction state and reports no drift,
   * which reads exactly like success.
   */
  executor: Executor = db,
) => {
  const rows = await executor.execute<{
    member_id: string;
    target_cents: string;
    posted_cents: string;
  }>(sql`
    with live_version as (
      select ev.id, ev.expense_id
      from expense_versions ev
      join expenses e
        on e.id = ev.expense_id
       and e.current_version = ev.version
       and e.deleted_at is null
      where e.group_id = ${groupId}
    ),
    contribution as (
      select p.member_id, sum(p.amount_cents)::bigint as cents
      from expense_payers p
      join live_version v on v.id = p.expense_version_id
      group by 1
      union all
      select s.member_id, -sum(s.amount_cents)::bigint
      from expense_shares s
      join live_version v on v.id = s.expense_version_id
      group by 1
      union all
      select from_member_id, sum(amount_cents)::bigint
      from settlements
      where group_id = ${groupId} and voided_at is null
      group by 1
      union all
      select to_member_id, -sum(amount_cents)::bigint
      from settlements
      where group_id = ${groupId} and voided_at is null
      group by 1
    ),
    target as (
      select member_id, sum(cents)::bigint as cents from contribution group by 1
    ),
    posted as (
      select member_id, sum(amount_cents)::bigint as cents
      from ledger_entries
      where group_id = ${groupId}
      group by 1
    )
    select coalesce(t.member_id, p.member_id) as member_id,
           coalesce(t.cents, 0)::text         as target_cents,
           coalesce(p.cents, 0)::text         as posted_cents
    from target t
    full outer join posted p on p.member_id = t.member_id
    where coalesce(t.cents, 0) <> coalesce(p.cents, 0)
  `);

  return rows.rows.map((row) => ({
    memberId: row.member_id,
    postedCents: Number(row.posted_cents),
    targetCents: Number(row.target_cents),
  }));
};
