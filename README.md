# budget

A group expense splitter. People share a **group** — a trip, a household, a
couple — add expenses by hand, and the app tracks what each person is owed. It
never moves money: settling up is something you record, not something it does.

```
apps/mobile     Expo Router app — email OTP auth, expenses, balances, settle-up
apps/web        TanStack Start (Vite) app — shadcn/Tailwind v4 starting point
packages/api    Fastify + tRPC + better-auth + Drizzle (Postgres)
packages/shared Types/schemas shared between the API and the clients
docker/         Local Postgres, pgAdmin and Mailpit
```

## Getting started

```sh
pnpm install
cp docker/.env.example docker/.env
cp packages/api/.env.example packages/api/.env
cp apps/mobile/.env.example apps/mobile/.env
pnpm start                                    # Postgres, pgAdmin, Mailpit
pnpm --filter @budget/api exec drizzle-kit migrate
pnpm dev                                      # everything, in tmux panes
```

Sign-in codes go to Mailpit at http://localhost:8025.

## The domain

A **group** has **members**. A member is a _seat_, not a user account: you can
split tonight's dinner with a roommate before they install the app, and their
history survives them leaving. Member ids — never user ids — are what the ledger
references, which is what keeps one person's position in two groups separate.

An **expense** is an amount, a description, a date, a set of **payers** (who
fronted the money) and a set of **shares** (who owes a slice). Payers sum to the
amount; shares sum to the amount.

A **settlement** is a claim that one member paid another outside the app. It is
attached to no expense — it settles a net position, not a line item.

## The ledger

This is the part worth reading before you change anything.

`ledger_entries` is the only record of who owes what. Every row is a signed
integer-cent amount against one member:

> **Positive means the group owes this member. Negative means this member owes
> the group.**

Six rules hold, and each one is a test in `src/lib/ledger.test.ts`:

1. **Money is integer cents.** `bigint` in Postgres, `number` in TS. Never a
   float, never a decimal string. Formatting happens in the client only.
2. **The table is append-only**, enforced by a database trigger. No UPDATE, no
   DELETE — not from application code, not from a migration, not from a fix
   script. A correction is a reversing INSERT with `reverses_id` pointing at the
   row it undoes, and a partial unique index makes a double reversal an error.
3. **Every logical event sums to zero.** Posting an expense writes `+A` across
   the payers and `-A` across the shares. Reversing writes the negation.
   Settling writes `+X` and `-X`. `assertZeroSum` checks it before every commit.
4. **Therefore every group sums to zero, always.** `getGroupImbalance` is the
   canary; the write paths call it before committing and a nightly pg-boss job
   sweeps every group.
5. **Balances are derived, never stored.** There is no balance column anywhere.
   A balance is `sum(amount_cents)` per member. Adding a cached column "for
   performance" is the mistake this design exists to prevent.
6. **Splits are stored as resolved cents, not percentages.** Rounding is decided
   once, at write time, by `allocate` in `packages/shared/src/money.ts`
   (largest-remainder, exact, sign-symmetric, stable). It lives in `shared` so
   the split editor previews the exact numbers the server will store.

Four functions write to the table, and nothing else may: `postExpenseVersion`,
`reverseExpenseVersion`, `postSettlement` and `reverseSettlement`, all in
`src/lib/ledger.ts`. Every transaction that calls one of them takes `lockGroup`
first — an advisory lock only excludes writers that also take it, so a writer
that skips it is invisible to every writer that does.

### Revisions

An expense is a row of identity plus a stack of `expense_versions`. Editing one
does not update anything: `reviseExpense` takes `lockGroup`, reads the expense
row `FOR UPDATE`, reverses every entry from the current version, writes version
N+1 with its own payers and shares, posts it, and moves `current_version`.
Deleting is the same minus the new version — the rows stay forever and
`deleted_at` is set.

The locks matter. Without them two concurrent edits both read the same
`current_version`, both reverse it and both post a new one, which silently
doubles a balance. There is a test that races them.

`expenses.history` is a first-class endpoint rather than a debugging aid — the
audit trail is what makes "any member may edit any expense" a safe rule.

### Settling up

`balances.summary` is one signed number per member. `balances.settleUp` runs the
greedy simplification in `src/lib/settle-up.ts` and returns the smallest set of
transfers that zeroes everybody — at most `members - 1` of them. It is
recomputed on every request and never stored, because a saved suggestion is
wrong the moment the next expense lands.

Recording one of those transfers is an ordinary `settlements.create`. The
client generates the id so a double-tap on a slow network cannot invent a
repayment that never happened.

Writing off a leaver's balance is not a special kind of entry: it records the
settlements that square them up, tagged `method: 'write-off'`, so it appears in
the payments list and reverses like anything else.

### Verifying it

`verifyLedger` recomputes every position from the documents themselves — the
current version of every live expense, plus every settlement that is not voided
— and reports anyone the ledger disagrees with. `getGroupImbalance` catches a
lopsided event; `verifyLedger` catches one that was skipped or double-posted
symmetrically, which sums to zero and is invisible to the first. Both run in
every integration test, on demand through `balances.verify`, and nightly.

## Authorization

`groupId` is resolved from the session and is **never** accepted as an input
anywhere in the API — there is no parameter to tamper with. On top of that,
every child table carries `group_id` and reaches its member through a composite
foreign key to `(group_members.id, group_members.group_id)`, so naming a member
of another group on an expense is refused by the database, not by a check
somebody might forget. `src/routes/scope.test.ts` asserts both layers.

## Testing

```sh
pnpm test                      # unit tests everywhere
pnpm --filter @budget/api test src/lib/settle-up.test.ts
```

The ledger and scope suites need a live Postgres with the migrations applied,
which CI does not have, so they are opt-in and skip themselves otherwise:

```sh
INTEGRATION_DATABASE_URL=postgresql://budget:budget@localhost:5432/budget \
  pnpm --filter @budget/api test
```

They create real groups and drop them afterwards, so a development database is a
safe target.

## What this app deliberately does not do

No bank or card feeds. No payment rails — nothing here moves money. No currency
conversion: a group has one currency, frozen the moment anything is posted. No
receipt scanning, no recurring expenses, no real-time sync.
