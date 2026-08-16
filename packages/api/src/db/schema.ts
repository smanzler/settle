import type { AllocationPart } from "@budget/shared";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  bigint,
  unique,
  uniqueIndex,
  jsonb,
  pgEnum,
  index,
  boolean,
  numeric,
  date,
  check,
  foreignKey,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth-schema";

export const householdRoleEnum = pgEnum("household_role", ["owner", "member"]);

export const householdMemberStatusEnum = pgEnum("household_member_status", [
  /** A seat exists; nobody has claimed it yet. */
  "invited",
  "active",
  /** Never DELETE a member — the ledger references them forever. */
  "removed",
]);

/**
 * The shared container. Everything below is scoped to one of these.
 *
 * Created eagerly at signup and never surfaced in the UI until a second member
 * exists, so the single-user experience is unchanged — see the `members.length`
 * gate on the client.
 */
export const Households = pgTable(
  "households",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    /**
     * The user this household was bootstrapped for. Its only job is to be a
     * real join key: the backfill and the signup hook both need to pair a user
     * with their household, and pairing on `name` is wrong the moment there are
     * two users — every user this app creates has `users.name = ''`, because
     * better-auth's emailOTP writes `name || ""` and the verify screen never
     * sends one.
     *
     * `set null`, not cascade: deleting the auth user must not delete a
     * household other people still have money riding on.
     */
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /**
     * Every ledger amount is assumed to be in this currency. A split on a
     * transaction in another currency is refused rather than converted.
     */
    defaultCurrency: text("default_currency").notNull().default("USD"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Was `uniqueIndex`, which capped a user at one household ever created.
    //
    // It cannot stay unique now that a user can leave a household they made:
    // `ensureHousehold` would find the old row, revive their retired seat, and
    // silently hand them `owner` over a household that now belongs to other
    // people. Bootstrap idempotency moved to an advisory lock keyed on the user
    // — see `bootstrapHousehold` in lib/household.ts — which is what the unique
    // index was really providing.
    index("households_created_by_user_id_idx").on(t.createdByUserId),
  ],
);

/**
 * Which household a user is currently acting in.
 *
 * A side table rather than a column on `users`, for two concrete reasons.
 * `schema.ts` re-exports better-auth's `auth-schema`, so drizzle-kit diffs
 * better-auth's own table and a column added there is invisible to its schema
 * management (`additionalFields` is the sanctioned extension point). And
 * `households.created_by_user_id → users.id` plus `users.active_household_id →
 * households.id` would be a circular FK, which `db/reset.ts` — drizzle-seed's
 * `reset`, whose delete order comes from the schema graph — cannot resolve.
 *
 * Per user, not per device: a switch is a write, so two devices cannot view
 * different households at once. Fine at this size, and a request header can
 * override this later with the stored value as its fallback.
 *
 * Nothing here is authorization. `householdProcedure` re-checks that the stored
 * household still has an active seat for the caller on every request, so a stale
 * or hand-edited value degrades to the fallback rather than granting anything.
 */
export const UserHouseholdPrefs = pgTable("user_household_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /**
   * `set null`, so deleting a household drops the pointer instead of blocking
   * the delete — resolution then falls back to the caller's oldest active seat.
   */
  activeHouseholdId: uuid("active_household_id").references(
    () => Households.id,
    { onDelete: "set null" },
  ),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * A member is a **seat**, not a user.
 *
 * `userId` is nullable on purpose: you can split a bill with a roommate who
 * hasn't accepted their invite — or who never installs the app — and the ledger
 * still balances. Accepting an invite fills `userId` in; it never creates a
 * second seat.
 *
 * `onDelete: "set null"` is deliberately different from every other user FK in
 * this schema. Deleting the auth user must not take the ledger with it.
 */
export const HouseholdMembers = pgTable(
  "household_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Shown before — and instead of — a linked user's name. */
    displayName: text("display_name").notNull(),
    role: householdRoleEnum().notNull().default("member"),
    status: householdMemberStatusEnum().notNull().default("invited"),
    joinedAt: timestamp("joined_at"),
    removedAt: timestamp("removed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    // NULLs are distinct in Postgres, so unclaimed seats don't collide here.
    unique("household_members_household_user_unique").on(
      t.householdId,
      t.userId,
    ),
    index("household_members_user_id_idx").on(t.userId),
    // Composite-FK target: lets child tables prove tenancy in the database
    // rather than by remembering a WHERE clause.
    unique("household_members_id_household_unique").on(t.id, t.householdId),
  ],
);

export const HouseholdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    /**
     * The seat this invite claims, created up front so you can split with
     * someone the moment you invite them.
     */
    memberId: uuid("member_id").notNull(),
    /**
     * Required, and lowercased at write time. The code travels through a share
     * sheet, so the code alone cannot be the guard: acceptance matches this
     * against the signed-in, email-verified session. A forwarded screenshot
     * must not hand a stranger every transaction in the household.
     */
    email: text("email").notNull(),
    code: text("code").notNull().unique(),
    invitedByMemberId: uuid("invited_by_member_id").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    revokedAt: timestamp("revoked_at"),
    /** Set by the single atomic redemption UPDATE — this is what makes it single-use. */
    redeemedAt: timestamp("redeemed_at"),
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("household_invites_household_id_idx").on(t.householdId),
    // One live invite per address per household — re-inviting reuses the row.
    uniqueIndex("household_invites_open_email_key")
      .on(t.householdId, t.email)
      .where(sql`redeemed_at is null and revoked_at is null`),
    // Serves `invites.mine`, which looks an address up across every household
    // and so can use neither of the two indexes above. Partial, because a
    // redeemed or revoked invite is never a candidate.
    index("household_invites_open_email_idx")
      .on(sql`lower(${t.email})`)
      .where(sql`redeemed_at is null and revoked_at is null`),
    foreignKey({
      columns: [t.memberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "household_invites_member_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.invitedByMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "household_invites_inviter_fk",
    }).onDelete("no action"),
  ],
);

export const Notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data"),
    dedupeKey: text("dedupe_key"),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique().on(t.userId, t.dedupeKey)],
);

export const channelEnum = pgEnum("channel", ["email", "mobile"]);
export const statusEnum = pgEnum("status", ["pending", "sent", "failed"]);

export const NotificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  notificationId: uuid("notification_id")
    .notNull()
    .references(() => Notifications.id, { onDelete: "cascade" }),
  channel: channelEnum().notNull(),
  deviceToken: text("device_token"),
  status: statusEnum().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at"),
});

export const PushTokens = pgTable("push_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * `syncing` is load-bearing for the UI: it lets the transaction list say
 * "fetching your transactions" on first connect instead of "no transactions",
 * which otherwise reads as a bug.
 *
 * `disconnected` is what `items.remove` now sets. Deleting the item would
 * cascade its transactions, and once money is owed that silently erases a real
 * debt — see `plaid.items.purge` for the destructive path.
 */
export const plaidItemStatusEnum = pgEnum("plaid_item_status", [
  "syncing",
  "active",
  "login_required",
  "error",
  "disconnected",
]);

/** One row per connected institution ("Item" in Plaid's vocabulary). */
export const PlaidItems = pgTable(
  "plaid_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    /**
     * The credential holder, **not** the creditor. Plaid's `client_user_id` and
     * the update-mode reconnect path are both per-user, so this stays even
     * though scoping moved to `household_id`.
     */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /**
     * The default owner member for accounts under this item, stamped once at
     * exchange time. Never re-derived from `user_id` at sync time: a member who
     * leaves keeps their seat but stops being resolvable by user, and a NOT
     * NULL lookup that returned nothing would throw inside the pg-boss worker
     * and silently stop all ingestion for this item.
     */
    ownerMemberId: uuid("owner_member_id").notNull(),
    plaidItemId: text("plaid_item_id").notNull().unique(),
    /**
     * AES-256-GCM ciphertext — see lib/crypto.ts. Never leaves the server.
     * Nulled on disconnect: the row survives, the credential does not.
     */
    accessToken: text("access_token"),
    institutionId: text("institution_id"),
    institutionName: text("institution_name"),
    institutionLogoUrl: text("institution_logo_url"),
    /** Plaid `/transactions/sync` cursor. Null means never synced. */
    cursor: text("cursor"),
    status: plaidItemStatusEnum().notNull().default("syncing"),
    lastSyncedAt: timestamp("last_synced_at"),
    disconnectedAt: timestamp("disconnected_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("plaid_items_user_id_idx").on(t.userId),
    index("plaid_items_household_id_idx").on(t.householdId),
    foreignKey({
      columns: [t.ownerMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "plaid_items_owner_fk",
    }).onDelete("no action"),
  ],
);

export const accountSplitDefaultEnum = pgEnum("account_split_default", [
  "owner",
  "equal",
]);

/**
 * Named `BankAccounts`, not `Accounts` — better-auth already owns `accounts`,
 * which is re-exported from this file.
 */
export const BankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    plaidItemId: uuid("plaid_item_id")
      .notNull()
      .references(() => PlaidItems.id, { onDelete: "cascade" }),
    /**
     * The creditor for transactions on this account — whose money actually
     * moves. Distinct from `plaid_items.user_id`, who merely holds the
     * credential. Copied from the item at insert and deliberately kept out of
     * the sync upsert's `set` list, or every sync would revert a manual owner
     * reassignment.
     */
    ownerMemberId: uuid("owner_member_id").notNull(),
    plaidAccountId: text("plaid_account_id").notNull(),
    name: text("name").notNull(),
    officialName: text("official_name"),
    type: text("type"),
    subtype: text("subtype"),
    mask: text("mask"),
    currentBalance: numeric("current_balance", { precision: 12, scale: 2 }),
    availableBalance: numeric("available_balance", { precision: 12, scale: 2 }),
    isoCurrencyCode: text("iso_currency_code"),
    /** Only the owner sees this account's transactions. */
    isPrivate: boolean("is_private").notNull().default(false),
    /**
     * How a *new* transaction on this account is split before anyone touches
     * it. Seed only — never re-applied to rows that already have splits.
     */
    defaultSplit: accountSplitDefaultEnum("default_split")
      .notNull()
      .default("owner"),
    /**
     * `equal` applies only to transactions dated on or after this. The column
     * that stops "share the joint Amex" from inventing two years of
     * retroactive debt the moment you flip the switch.
     */
    defaultSplitFrom: date("default_split_from"),
    /**
     * A muted duplicate — two members both linked the same joint account. Its
     * rows are hidden from the list and never split.
     */
    excludedAt: timestamp("excluded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("bank_accounts_household_id_idx").on(t.householdId),
    index("bank_accounts_plaid_item_id_idx").on(t.plaidItemId),
    // Was a global unique on `plaid_account_id`. Plaid account ids are unique
    // per Item, not per bank: a global unique lets a colliding id stay parented
    // to the OLD item, after which `listAccountIds` never finds it and
    // `syncItemTransactions` silently drops every transaction for that account
    // forever.
    unique("bank_accounts_item_account_unique").on(
      t.plaidItemId,
      t.plaidAccountId,
    ),
    unique("bank_accounts_id_household_unique").on(t.id, t.householdId),
    foreignKey({
      columns: [t.ownerMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "bank_accounts_owner_fk",
    }).onDelete("no action"),
  ],
);

export const splitMethodEnum = pgEnum("split_method", [
  /** The whole amount sits with the creditor. Produces no ledger entries. */
  "owner",
  "shares",
  "exact",
]);

/**
 * Amounts are stored verbatim from Plaid: **positive means money left the
 * account**. Keeping Plaid's sign makes re-syncs byte-idempotent and makes rows
 * match the Plaid dashboard when debugging. Exactly one client module is
 * allowed to interpret it (mobile `features/transactions/lib/format.ts`).
 *
 * `numeric` is returned by Drizzle as a **string** — never do float math on it.
 * Use `toCents` from `@budget/shared` at the ledger boundary instead.
 */
export const Transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Denormalized so the keyset list needs no join to scope itself. */
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    bankAccountId: uuid("bank_account_id").notNull(),
    /**
     * Who is owed for this transaction — **frozen at insert** from the
     * account's `owner_member_id`, and re-derived in exactly one case: Plaid
     * moved the row to a different account, which is the only time the payer
     * genuinely changed.
     *
     * This is what makes `household.setAccountOwner` truly prospective. If the
     * ledger read the account's *current* owner instead, a routine Plaid
     * `modified` on a three-month-old row would re-post its shares against the
     * new owner and drain the old pair to zero — hundreds of dollars
     * reassigned by a webhook.
     */
    creditorMemberId: uuid("creditor_member_id").notNull(),
    /** The sync idempotency key. */
    plaidTransactionId: text("plaid_transaction_id").notNull().unique(),
    /**
     * Plaid retires a pending charge by `removed`-ing it and `added`-ing the
     * posted charge under a NEW id, linked by this. Without it, every manual
     * split on a pending charge dies two or three days later.
     */
    plaidPendingTransactionId: text("plaid_pending_transaction_id"),
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    isoCurrencyCode: text("iso_currency_code"),
    /** Drizzle returns `date` columns as `YYYY-MM-DD` strings. */
    date: date("date").notNull(),
    authorizedDate: date("authorized_date"),
    /** Raw bank description. */
    name: text("name").notNull(),
    merchantName: text("merchant_name"),
    /** Personal finance category, primary. */
    category: text("category"),
    categoryDetailed: text("category_detailed"),
    paymentChannel: text("payment_channel"),
    pending: boolean("pending").notNull().default(false),
    logoUrl: text("logo_url"),
    splitMethod: splitMethodEnum("split_method").notNull().default("owner"),
    /**
     * "Amount changed — review split". Set when an `exact` split could not be
     * honoured against a new amount.
     */
    splitsStale: boolean("splits_stale").notNull().default(false),
    /** Copied from the account so the list's privacy filter needs no join. */
    isPrivate: boolean("is_private").notNull().default(false),
    splitUpdatedAt: timestamp("split_updated_at"),
    splitUpdatedByMemberId: uuid("split_updated_by_member_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Serves the keyset-paginated list query.
    index("transactions_household_id_date_id_idx").on(
      t.householdId,
      t.date.desc(),
      t.id.desc(),
    ),
    index("transactions_bank_account_id_idx").on(t.bankAccountId),
    index("transactions_pending_transaction_id_idx")
      .on(t.plaidPendingTransactionId)
      .where(sql`plaid_pending_transaction_id is not null`),
    unique("transactions_id_household_unique").on(t.id, t.householdId),
    // Composite, replacing the single-column FK: the database refuses to
    // attach a transaction to an account in another household.
    foreignKey({
      columns: [t.bankAccountId, t.householdId],
      foreignColumns: [BankAccounts.id, BankAccounts.householdId],
      name: "transactions_bank_account_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.creditorMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "transactions_creditor_fk",
    }).onDelete("no action"),
  ],
);

/**
 * One row per participating member. The invariant, asserted in code after every
 * allocation including the sync path's:
 *
 *   SUM(amount_cents) === toCents(transactions.amount), exactly, including sign.
 *
 * There is no rounding at read time anywhere. The creditor is **always** present
 * as a participant — usually holding the whole amount — so the editor has
 * something to show and a split never has to special-case "and the rest".
 */
export const TransactionSplits = pgTable(
  "transaction_splits",
  {
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id").notNull(),
    memberId: uuid("member_id").notNull(),
    /**
     * The recompute recipe, and the thing that survives a Plaid amount change.
     * Equal = all 1s; percentages = weights out of 100; `exact` freezes them.
     * Bounded so `total * weight` cannot leave the safe integer range —
     * 1e12 cents × 1000 = 1e15 < 2^53.
     */
    weight: integer("weight").notNull().default(1),
    /**
     * Signed, in Plaid's convention: positive means this member consumed money
     * that left the account, negative means a refund accruing to them.
     */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // The natural key: a member cannot appear twice, it clusters a
    // transaction's splits for the list-hydration query, and it is the conflict
    // target for the reconcile upsert.
    primaryKey({ columns: [t.transactionId, t.memberId] }),
    index("transaction_splits_member_id_idx").on(t.memberId),
    check(
      "transaction_splits_weight_range",
      sql`${t.weight} > 0 and ${t.weight} <= 1000`,
    ),
    foreignKey({
      columns: [t.transactionId, t.householdId],
      foreignColumns: [Transactions.id, Transactions.householdId],
      name: "transaction_splits_transaction_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.memberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "transaction_splits_member_fk",
      // NO ACTION, not RESTRICT: RESTRICT is checked immediately, so deleting a
      // household would abort on its own member cascade even though these rows
      // are cascaded by household_id in the same statement. NO ACTION defers to
      // end of statement and still blocks a direct member delete. It is also
      // what keeps `pnpm reset` (drizzle-seed) working.
    }).onDelete("no action"),
  ],
);

export const Settlements = pgTable(
  "settlements",
  {
    /**
     * Supplied by the **client** and inserted with `onConflictDoNothing`.
     * "Settle up" prefills the full outstanding amount, so a double-tap or a
     * TanStack retry is the single most likely way to invent a repayment.
     */
    id: uuid("id").primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    fromMemberId: uuid("from_member_id").notNull(),
    toMemberId: uuid("to_member_id").notNull(),
    /**
     * Always positive — direction lives in from/to, never in the sign, because
     * "I paid you back -$40" is not a sentence.
     */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    isoCurrencyCode: text("iso_currency_code").notNull(),
    settledOn: date("settled_on").notNull(),
    /** "cash" | "venmo" | free text. */
    method: text("method"),
    note: text("note"),
    createdByMemberId: uuid("created_by_member_id").notNull(),
    /**
     * Soft void, followed by an appended reversal. A settlement is a claim
     * about real money; the other party must be able to see it was taken back.
     */
    voidedAt: timestamp("voided_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("settlements_household_idx").on(t.householdId, t.settledOn.desc()),
    check("settlements_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "settlements_distinct_parties",
      sql`${t.fromMemberId} <> ${t.toMemberId}`,
    ),
    foreignKey({
      columns: [t.fromMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "settlements_from_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [t.toMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "settlements_to_fk",
    }).onDelete("no action"),
  ],
);

export const ledgerEntryKindEnum = pgEnum("ledger_entry_kind", [
  /** A member's slice of a transaction. */
  "share",
  /** Someone paid someone back. */
  "settlement",
  /** Manual "call it even" / write-off. */
  "adjustment",
]);

/**
 * **Append only.** No UPDATE, no DELETE, ever. A correction is a new row —
 * negative, or with `reversesEntryId` set. Balances are the SUM of this table,
 * so a mutation here would rewrite history nobody could reproduce.
 */
export const LedgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => Households.id, { onDelete: "cascade" }),
    debtorMemberId: uuid("debtor_member_id").notNull(),
    creditorMemberId: uuid("creditor_member_id").notNull(),
    /** Signed. Negative reverses the pair's direction — refunds, payoffs. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /**
     * NOT NULL, resolved as COALESCE(transaction currency, household default)
     * at post time. Plaid nulls `iso_currency_code` whenever it sets
     * `unofficial_currency_code`, and a nullable column here means a NULL that
     * slips past a `<> 'USD'` guard gets summed into the USD balance.
     */
    isoCurrencyCode: text("iso_currency_code").notNull(),
    kind: ledgerEntryKindEnum().notNull(),
    /**
     * The idempotency key. `plaid:<plaidTransactionId>` for shares,
     * `settlement:<uuid>` and `settlement:<uuid>:void` for payoffs. Keyed on the
     * ref rather than `transaction_id` so reconciliation still works once the
     * transaction row is gone — a Plaid `removed`, or an item purge.
     */
    externalRef: text("external_ref").notNull(),
    /** A convenience join for display. NULLed, never cascaded, on delete. */
    transactionId: uuid("transaction_id").references(() => Transactions.id, {
      onDelete: "set null",
    }),
    /**
     * NO ACTION, not RESTRICT — the same trap documented on
     * `transaction_splits_member_fk`. Both this table and `settlements` cascade
     * from `households`, and RESTRICT is checked immediately rather than at end
     * of statement, so deleting a household could abort partway through its own
     * cascade depending on which FK trigger happens to fire first. NO ACTION
     * defers to end of statement and still blocks deleting a settlement that
     * has entries, which is the property actually wanted here.
     */
    settlementId: uuid("settlement_id").references(() => Settlements.id, {
      onDelete: "no action",
    }),
    reversesEntryId: uuid("reverses_entry_id"),
    /**
     * Frozen at post time so a detached entry still reads as
     * "Luigi's — Aug 3 — $50" after its transaction has been purged.
     */
    memo: text("memo"),
    effectiveDate: date("effective_date").notNull(),
    createdByMemberId: uuid("created_by_member_id"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("ledger_entries_household_ref_idx").on(t.householdId, t.externalRef),
    index("ledger_entries_household_date_id_idx").on(
      t.householdId,
      t.effectiveDate.desc(),
      t.id.desc(),
    ),
    // Serve balances.activity({ memberId }) from either side of the pair.
    index("ledger_entries_debtor_idx").on(
      t.householdId,
      t.debtorMemberId,
      t.effectiveDate.desc(),
      t.id.desc(),
    ),
    index("ledger_entries_creditor_idx").on(
      t.householdId,
      t.creditorMemberId,
      t.effectiveDate.desc(),
      t.id.desc(),
    ),
    // A zero-value entry carries no information and would only be noise in the
    // activity feed; `postShareDeltas` never emits one.
    check("ledger_entries_amount_nonzero", sql`${t.amountCents} <> 0`),
    check(
      "ledger_entries_distinct_parties",
      sql`${t.debtorMemberId} <> ${t.creditorMemberId}`,
    ),
    foreignKey({
      columns: [t.debtorMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "ledger_entries_debtor_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [t.creditorMemberId, t.householdId],
      foreignColumns: [HouseholdMembers.id, HouseholdMembers.householdId],
      name: "ledger_entries_creditor_fk",
    }).onDelete("no action"),
  ],
);

/**
 * Archived split intent, keyed by the **Plaid** id rather than our row id.
 *
 * Plaid retires a pending charge with `removed(<pending_id>)` and delivers the
 * posted charge as `added(<posted_id>)` carrying `pending_transaction_id`. Those
 * two do not have to arrive in the same `/transactions/sync` response, and the
 * removal can come first — at which point the pending row and its splits are
 * gone and there is nothing left to copy from. Writing the intent here on every
 * `removed` of a hand-split transaction makes the carryover work in *both*
 * orderings, instead of resting on the delete loop happening to run after the
 * upsert loop.
 */
export const SplitIntents = pgTable("split_intents", {
  plaidTransactionId: text("plaid_transaction_id").primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => Households.id, { onDelete: "cascade" }),
  splitMethod: splitMethodEnum("split_method").notNull(),
  /**
   * `[{ memberId, weight, amountCents }]` — the recipe *and* the cents.
   *
   * The weights alone are enough to carry a `shares` split across the
   * pending→posted boundary, but not an `exact` one: those cents are numbers a
   * human typed, and re-running the allocator over their weights (all 1s) turns
   * a hand-made split into an equal one two days later, silently.
   *
   * `amountCents` is optional because rows written before it existed do not
   * carry it; those replay as weights, which is exactly the old behaviour.
   */
  parts: jsonb("parts").notNull().$type<SplitIntentPart[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * A member's slice as `split_intents.parts` persists it.
 *
 * The weight half is the shared `AllocationPart`, so the archived intent and the
 * allocator that replays it cannot drift apart.
 */
export type SplitIntentPart = AllocationPart & { amountCents?: number };

export * from "./auth-schema";
