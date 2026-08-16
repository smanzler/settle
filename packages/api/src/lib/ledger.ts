import { sql } from "drizzle-orm";
import db from "../db";

/** The Drizzle transaction handle, as `db.transaction` hands it to a callback. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A directed debt between two members, in Plaid's sign convention. */
export type SharePair = {
  debtorMemberId: string;
  creditorMemberId: string;
  /** Signed. Positive means the debtor consumed money the creditor put up. */
  cents: number;
};

export type ShareTarget = {
  /** `plaid:<plaidTransactionId>`. The idempotency key. */
  externalRef: string;
  /** Null once the underlying row is gone — a Plaid `removed`, or a purge. */
  transactionId: string | null;
  /** Frozen onto the entry so it still reads correctly after a purge. */
  memo: string | null;
  /** `YYYY-MM-DD`. Display and ordering only; balances never filter by date. */
  effectiveDate: string;
  isoCurrencyCode: string;
  /**
   * What the splits currently say. **Empty means reverse everything posted for
   * this ref** — the deletion path.
   */
  pairs: SharePair[];
};

/** `plaid:<id>` — the only place this string is built. */
export const shareRef = (plaidTransactionId: string) =>
  `plaid:${plaidTransactionId}`;

export const settlementRef = (settlementId: string) =>
  `settlement:${settlementId}`;

/**
 * A transaction's shares, as a target.
 *
 * Everything but `pairs` is identity rather than data: the ref is what makes a
 * re-post idempotent, and memo, date and currency are frozen onto the entries
 * so they still read correctly once the transaction row is gone. Restating
 * those per call site is how two writers post the same share under different
 * metadata — a drift `verifyLedger` cannot see, because it only compares cents.
 *
 * `transactionId` is `null` for a row that is about to be deleted; pass the
 * household's default currency, which is what an entry falls back to when the
 * transaction never carried one.
 */
export const shareTargetFor = (
  transaction: {
    id: string | null;
    plaidTransactionId: string;
    name: string;
    merchantName: string | null;
    date: string;
    isoCurrencyCode: string | null;
  },
  defaultCurrency: string,
  pairs: SharePair[],
): ShareTarget => ({
  externalRef: shareRef(transaction.plaidTransactionId),
  transactionId: transaction.id,
  memo: transaction.merchantName ?? transaction.name,
  effectiveDate: transaction.date,
  isoCurrencyCode: transaction.isoCurrencyCode ?? defaultCurrency,
  pairs,
});

/**
 * Converges `ledger_entries` onto `targets` by appending **only the difference**
 * between what the splits now say and what has already been posted.
 *
 * This is the single write path for share entries, and every caller is the same
 * call:
 *
 *   new transaction   → nothing posted, target is the default split
 *   user edits split  → deltas move cents between pairs
 *   Plaid amount move → deltas absorb the difference
 *   account moved     → the old pair drains to 0, the new one fills
 *   Plaid `removed`   → empty target, every posted pair reversed to exactly 0
 *
 * Idempotent by construction: a second call computes a delta of zero for every
 * pair and the `WHERE ... <> 0` filter inserts nothing.
 *
 * Takes refs and targets rather than a transaction id, because the two cases
 * the ref key exists for — a deleted transaction and a purged item — have no
 * transaction row left to re-derive a target from. Callers compute the target.
 */
export const postShareDeltas = async (
  tx: Tx,
  args: {
    householdId: string;
    targets: ShareTarget[];
    actorMemberId?: string | null;
  },
) => {
  if (args.targets.length === 0) return;

  await lockHousehold(tx, args.householdId);

  // Two separate JSON payloads rather than one denormalized rowset: a reversal
  // has no pairs at all, and it still needs a memo, date and currency to freeze
  // onto the reversing entry.
  //
  // `ref_meta` MUST hold at most one row per ref. It is joined onto the delta
  // below, so a repeated `external_ref` would multiply every computed delta by
  // however many times it appeared — a doubled debt, not a doubled no-op. Two
  // targets for one ref are reachable: Plaid can return the same transaction in
  // `modified` and in `removed` within a single sync response, which produces a
  // share target and a reversal target for the same key. Last target wins,
  // matching the order callers apply them in.
  //
  // The pairs are deduped alongside the refs rather than accumulated across
  // duplicates: a reversal's empty `pairs` is a statement about the whole ref,
  // and merging it with a stale target's pairs would re-post the very shares it
  // exists to undo.
  const targets = [
    ...new Map(
      args.targets.map((target) => [target.externalRef, target]),
    ).values(),
  ];

  const refs = targets.map((target) => ({
    external_ref: target.externalRef,
    transaction_id: target.transactionId,
    memo: target.memo,
    effective_date: target.effectiveDate,
    iso_currency_code: target.isoCurrencyCode,
  }));

  const pairs = targets.flatMap((target) =>
    target.pairs
      // A zero-cent share is not a debt; letting one through would trip the
      // `amount_cents <> 0` CHECK for no gain.
      .filter((pair) => pair.cents !== 0)
      .map((pair) => ({
        external_ref: target.externalRef,
        debtor_member_id: pair.debtorMemberId,
        creditor_member_id: pair.creditorMemberId,
        cents: pair.cents,
      })),
  );

  // One statement for the whole delta. A per-row version would be two round
  // trips per transaction across up to ~8,000 rows on a first sync
  // (DAYS_REQUESTED is 730), inside an open write transaction, against a 20s
  // syncNow budget.
  await tx.execute(sql`
    with ref_meta as (
      select * from json_to_recordset(${JSON.stringify(refs)}::json) as x(
        external_ref text,
        transaction_id uuid,
        memo text,
        effective_date date,
        iso_currency_code text
      )
    ),
    target_pair as (
      select external_ref, debtor_member_id, creditor_member_id,
             sum(cents)::bigint as cents
      from json_to_recordset(${JSON.stringify(pairs)}::json) as y(
        external_ref text,
        debtor_member_id uuid,
        creditor_member_id uuid,
        cents bigint
      )
      group by 1, 2, 3
    ),
    posted as (
      select external_ref, debtor_member_id, creditor_member_id,
             sum(amount_cents)::bigint as cents
      from ledger_entries
      where household_id = ${args.householdId}
        and kind = 'share'
        and external_ref in (select external_ref from ref_meta)
      group by 1, 2, 3
    )
    insert into ledger_entries (
      household_id, debtor_member_id, creditor_member_id, amount_cents,
      iso_currency_code, kind, external_ref, transaction_id, memo,
      effective_date, created_by_member_id
    )
    select
      ${args.householdId},
      coalesce(t.debtor_member_id, p.debtor_member_id),
      coalesce(t.creditor_member_id, p.creditor_member_id),
      coalesce(t.cents, 0) - coalesce(p.cents, 0),
      m.iso_currency_code,
      'share',
      m.external_ref,
      m.transaction_id,
      m.memo,
      m.effective_date,
      ${args.actorMemberId ?? null}
    from target_pair t
    full outer join posted p
      on p.external_ref = t.external_ref
     and p.debtor_member_id = t.debtor_member_id
     and p.creditor_member_id = t.creditor_member_id
    join ref_meta m
      on m.external_ref = coalesce(t.external_ref, p.external_ref)
    where coalesce(t.cents, 0) - coalesce(p.cents, 0) <> 0
  `);
};

/**
 * Serializes ledger writes for one household.
 *
 * `postShareDeltas` is read-then-append and Drizzle runs at READ COMMITTED, so
 * two concurrent callers would both read "nothing posted" and both insert the
 * full amount. Two live paths reach it simultaneously today: pull-to-refresh
 * runs `syncItemTransactions` inline while a SYNC_UPDATES_AVAILABLE webhook can
 * run the same item on the pg-boss worker, and pg-boss's `singletonKey` only
 * dedupes *queued* jobs, not the inline path.
 *
 * Household-level rather than per-ref: one call covers a whole sync batch, and
 * write volume here is tiny.
 */
export const lockHousehold = (tx: Tx, householdId: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${householdId}, 0))`,
  );

/**
 * The insurance an append-only projection otherwise lacks.
 *
 * `ledger_entries` is only correct if no `postShareDeltas` call was ever
 * missed. This recomputes the target from the splits themselves and reports
 * every ref where the posted entries disagree, which turns "permanently and
 * undetectably wrong" into "detectable, and one call away from converging".
 *
 * Every disagreeing ref is reported. `detached` says which kind it is:
 *
 *   detached: false — the transaction is still here and its entries do not
 *     match its splits. This is the bug class the check exists for.
 *   detached: true  — the transaction row is gone, so there are no splits to
 *     recompute a target from and it reads as 0. A purge retains the entries on
 *     purpose ("deleting your data must not delete what you owe"), so these are
 *     expected — but a Plaid `removed` whose reversal never ran looks identical,
 *     so they are labelled rather than filtered out.
 *
 * Read-only, and milliseconds at this scale. Run it in tests and expose it to
 * the household owner.
 */
export const verifyLedger = async (
  householdId: string,
  /**
   * Defaults to a fresh connection because the procedure that exposes this is
   * a plain query. Pass a transaction handle to check work that has not been
   * committed yet — otherwise this reads the pre-transaction state and reports
   * no drift, which reads exactly like success.
   */
  executor: Pick<typeof db, "execute"> | Tx = db,
) => {
  const rows = await executor.execute<{
    external_ref: string;
    debtor_member_id: string;
    creditor_member_id: string;
    target_cents: string;
    posted_cents: string;
    detached: boolean;
  }>(sql`
    with target as (
      select 'plaid:' || t.plaid_transaction_id as external_ref,
             s.member_id as debtor_member_id,
             t.creditor_member_id as creditor_member_id,
             sum(s.amount_cents)::bigint as cents
      from transaction_splits s
      join transactions t on t.id = s.transaction_id
      where t.household_id = ${householdId}
        and s.member_id <> t.creditor_member_id
      group by 1, 2, 3
    ),
    posted as (
      select external_ref, debtor_member_id, creditor_member_id,
             sum(amount_cents)::bigint as cents
      from ledger_entries
      where household_id = ${householdId} and kind = 'share'
      group by 1, 2, 3
    ),
    -- Every ref this household still has a transaction row for.
    -- plaid_transaction_id is unique, so this cannot duplicate a joined row.
    live as (
      select 'plaid:' || plaid_transaction_id as external_ref
      from transactions
      where household_id = ${householdId}
    )
    select coalesce(t.external_ref, p.external_ref)             as external_ref,
           coalesce(t.debtor_member_id, p.debtor_member_id)     as debtor_member_id,
           coalesce(t.creditor_member_id, p.creditor_member_id) as creditor_member_id,
           coalesce(t.cents, 0)::text                           as target_cents,
           coalesce(p.cents, 0)::text                           as posted_cents,
           (l.external_ref is null)                             as detached
    from target t
    full outer join posted p
      on p.external_ref = t.external_ref
     and p.debtor_member_id = t.debtor_member_id
     and p.creditor_member_id = t.creditor_member_id
    left join live l
      on l.external_ref = coalesce(t.external_ref, p.external_ref)
    where coalesce(t.cents, 0) <> coalesce(p.cents, 0)
  `);

  // `sum(bigint)` comes back from node-postgres as a string; casting to text
  // above makes that explicit rather than a surprise at the call site.
  return rows.rows.map((row) => ({
    externalRef: row.external_ref,
    debtorMemberId: row.debtor_member_id,
    creditorMemberId: row.creditor_member_id,
    targetCents: Number(row.target_cents),
    postedCents: Number(row.posted_cents),
    detached: row.detached,
  }));
};
