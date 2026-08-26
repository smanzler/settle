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
  date,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth-schema";

export const groupRoleEnum = pgEnum("group_role", ["owner", "member"]);

export const groupMemberStatusEnum = pgEnum("group_member_status", [
  /** A seat exists; nobody has claimed it yet. */
  "invited",
  "active",
  /** Never DELETE a member — the ledger references them forever. */
  "removed",
]);

/**
 * The shared container — a trip, a household, a couple. Everything below is
 * scoped to one of these.
 *
 * Created eagerly at signup so the very first request already has a seat to act
 * as, and created again on demand by `groups.create`.
 */
export const Groups = pgTable("groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  /**
   * The user this group was bootstrapped for. Its only job is to be a real join
   * key for the signup hook.
   *
   * `set null`, not cascade: deleting the auth user must not delete a group
   * other people still have money riding on.
   */
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  /**
   * Every amount in this group is in this currency. Chosen when the group is
   * made and never changed: nothing in the app converts, so re-denominating a
   * group that already has balances would silently restate what people owe.
   */
  isoCurrencyCode: text("iso_currency_code").notNull().default("USD"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Which group a user is currently acting in.
 *
 * Not an authorization record: `resolveActiveMember` checks the stored id
 * against an *active seat for this user*, so a stale or tampered value selects
 * nothing and falls through to their oldest seat.
 */
export const UserGroupPrefs = pgTable("user_group_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  activeGroupId: uuid("active_group_id").references(() => Groups.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A seat, not a user: you can split a bill with somebody before they install
 * the app, and their history survives them leaving.
 *
 * Member ids — never user ids — are what the ledger references, which is what
 * keeps one person's position in two groups fully separate.
 */
export const GroupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => Groups.id, { onDelete: "cascade" }),
    /** Null until the seat's invite is accepted. */
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    displayName: text("display_name").notNull(),
    role: groupRoleEnum("role").notNull().default("member"),
    status: groupMemberStatusEnum("status").notNull().default("invited"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    index("group_members_group_id_idx").on(t.groupId),
    index("group_members_user_id_idx").on(t.userId),
    /**
     * One live seat per person per group. **Partial**, because a retired seat
     * keeps its `user_id` forever — the ledger references the seat and its
     * history has to keep naming who held it — and a plain unique constraint
     * would then make re-inviting somebody who left fail on the accept, with a
     * raw constraint violation and no way back.
     */
    uniqueIndex("group_members_group_user_key")
      .on(t.groupId, t.userId)
      .where(sql`status <> 'removed'`),
    /**
     * The target of every composite FK below. Redundant on its own — `id` is
     * already the primary key — and load-bearing as a reference: it is what
     * lets a child row prove its member belongs to the same group as itself,
     * so a member of group A can never be named on group B's expense.
     */
    unique("group_members_id_group_unique").on(t.id, t.groupId),
  ],
);

export const GroupInvites = pgTable(
  "group_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => Groups.id, { onDelete: "cascade" }),
    /**
     * The seat this invite claims, created up front so you can split with
     * someone the moment you invite them.
     */
    memberId: uuid("member_id").notNull(),
    /**
     * Required, and lowercased at write time. The code travels through a share
     * sheet, so the code alone cannot be the guard: acceptance matches this
     * against the signed-in, email-verified session. A forwarded screenshot
     * must not hand a stranger every expense in the group.
     */
    email: text("email").notNull(),
    code: text("code").notNull().unique(),
    invitedByMemberId: uuid("invited_by_member_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    /** Set by the single atomic redemption UPDATE — this is what makes it single-use. */
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    redeemedByUserId: uuid("redeemed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("group_invites_group_id_idx").on(t.groupId),
    // One live invite per address per group — re-inviting reuses the row.
    uniqueIndex("group_invites_open_email_key")
      .on(t.groupId, t.email)
      .where(sql`redeemed_at is null and revoked_at is null`),
    // Serves `invites.mine`, which looks an address up across every group and
    // so can use neither of the two indexes above. Partial, because a redeemed
    // or revoked invite is never a candidate.
    index("group_invites_open_email_idx")
      .on(sql`lower(${t.email})`)
      .where(sql`redeemed_at is null and revoked_at is null`),
    foreignKey({
      columns: [t.memberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "group_invites_member_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.invitedByMemberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "group_invites_inviter_fk",
    }).onDelete("no action"),
  ],
);

/**
 * The identity of an expense, and nothing else.
 *
 * Every fact about it — amount, description, date, who paid, who owes — lives
 * on a version, so an edit appends rather than overwrites. `currentVersion`
 * names the one in force; the rest are the audit trail, and they are never
 * deleted.
 */
export const Expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => Groups.id, { onDelete: "cascade" }),
    currentVersion: integer("current_version").notNull().default(1),
    createdByMemberId: uuid("created_by_member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft only. The rows stay; the ledger is reversed instead. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("expenses_group_created_idx").on(t.groupId, t.createdAt.desc()),
    unique("expenses_id_group_unique").on(t.id, t.groupId),
    foreignKey({
      columns: [t.createdByMemberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "expenses_created_by_fk",
    }).onDelete("no action"),
  ],
);

export const ExpenseVersions = pgTable(
  "expense_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id").notNull(),
    /**
     * Denormalized from the parent so the composite FKs below have something to
     * match on. It is not a second source of truth: `expense_versions_expense_fk`
     * is composite too, so a version whose group disagreed with its expense
     * cannot be inserted.
     */
    groupId: uuid("group_id").notNull(),
    version: integer("version").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    description: text("description").notNull(),
    expenseDate: date("expense_date").notNull(),
    /** Free text on the revision itself — "tip posted", "split was wrong". */
    note: text("note"),
    createdByMemberId: uuid("created_by_member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("expense_versions_expense_version_unique").on(
      t.expenseId,
      t.version,
    ),
    unique("expense_versions_id_group_unique").on(t.id, t.groupId),
    index("expense_versions_date_idx").on(t.groupId, t.expenseDate.desc()),
    check("expense_versions_amount_positive", sql`${t.amountCents} > 0`),
    check("expense_versions_version_positive", sql`${t.version} > 0`),
    foreignKey({
      columns: [t.expenseId, t.groupId],
      foreignColumns: [Expenses.id, Expenses.groupId],
      name: "expense_versions_expense_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.createdByMemberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "expense_versions_created_by_fk",
    }).onDelete("no action"),
  ],
);

/** Who fronted the money. Sums to the version's amount. */
export const ExpensePayers = pgTable(
  "expense_payers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseVersionId: uuid("expense_version_id").notNull(),
    groupId: uuid("group_id").notNull(),
    memberId: uuid("member_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    unique("expense_payers_version_member_unique").on(
      t.expenseVersionId,
      t.memberId,
    ),
    check("expense_payers_amount_positive", sql`${t.amountCents} > 0`),
    foreignKey({
      columns: [t.expenseVersionId, t.groupId],
      foreignColumns: [ExpenseVersions.id, ExpenseVersions.groupId],
      name: "expense_payers_version_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.memberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "expense_payers_member_fk",
      // NO ACTION rather than RESTRICT: a seat is retired, never deleted, so
      // this only has to refuse the delete that never happens.
    }).onDelete("no action"),
  ],
);

/**
 * Who owes a share. Sums to the version's amount.
 *
 * Keyed to the **version**, not the expense: changing who is on the split is a
 * revision like any other, and the old participant list has to stay readable.
 */
export const ExpenseShares = pgTable(
  "expense_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseVersionId: uuid("expense_version_id").notNull(),
    groupId: uuid("group_id").notNull(),
    memberId: uuid("member_id").notNull(),
    /** Zero is legal — "you were there, you don't owe anything". */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    unique("expense_shares_version_member_unique").on(
      t.expenseVersionId,
      t.memberId,
    ),
    check("expense_shares_amount_non_negative", sql`${t.amountCents} >= 0`),
    foreignKey({
      columns: [t.expenseVersionId, t.groupId],
      foreignColumns: [ExpenseVersions.id, ExpenseVersions.groupId],
      name: "expense_shares_version_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.memberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "expense_shares_member_fk",
    }).onDelete("no action"),
  ],
);

/**
 * A peer-to-peer repayment. Deliberately attached to no expense: it settles a
 * net position, not a line item.
 */
export const Settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => Groups.id, { onDelete: "cascade" }),
    fromMemberId: uuid("from_member_id").notNull(),
    toMemberId: uuid("to_member_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    /** Free text: 'cash', 'venmo', 'zelle'. */
    method: text("method"),
    note: text("note"),
    settledOn: date("settled_on").notNull(),
    createdByMemberId: uuid("created_by_member_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Soft. The row stays visible so a withdrawn claim is seen, not missing. */
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [
    index("settlements_group_date_idx").on(
      t.groupId,
      t.settledOn.desc(),
      t.id.desc(),
    ),
    check("settlements_amount_positive", sql`${t.amountCents} > 0`),
    check(
      "settlements_distinct_members",
      sql`${t.fromMemberId} <> ${t.toMemberId}`,
    ),
    foreignKey({
      columns: [t.fromMemberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "settlements_from_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [t.toMemberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "settlements_to_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [t.createdByMemberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "settlements_created_by_fk",
    }).onDelete("no action"),
  ],
);

export const ledgerEntryTypeEnum = pgEnum("ledger_entry_type", [
  /** Money this member fronted. */
  "paid",
  /** Money this member consumed. */
  "share",
  /** A repayment, in either direction. */
  "settlement",
]);

export const ledgerSourceTypeEnum = pgEnum("ledger_source_type", [
  "expense",
  "settlement",
]);

/**
 * The only record of who owes what. Append-only, enforced by a trigger the
 * migration installs — see `ledger_entries_immutable()`.
 *
 * **Sign convention, stated once so nobody has to re-derive it: positive means
 * the group owes this member; negative means this member owes the group.**
 *
 * Three properties hold at every instant, and every one of them is a test:
 *
 * - each logical event (post, reverse, settle) appends a set summing to zero;
 * - therefore `sum(amount_cents)` over a whole group is always zero;
 * - a balance is that sum per member, derived on read. There is no balance
 *   column anywhere, and adding one "for performance" is the mistake this
 *   design exists to make impossible.
 *
 * Corrections are reversals: append the negation and point `reverses_id` at the
 * original. Nothing is ever updated or deleted.
 */
export const LedgerEntries = pgTable(
  "ledger_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => Groups.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull(),
    /** Signed. See the sign convention above. */
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    entryType: ledgerEntryTypeEnum("entry_type").notNull(),
    sourceType: ledgerSourceTypeEnum("source_type").notNull(),
    /**
     * The expense or settlement this came from. Not a foreign key: it points at
     * one of two tables, and the entries have to outlive neither — an expense is
     * soft-deleted precisely so this stays resolvable.
     */
    sourceId: uuid("source_id").notNull(),
    /** Which expense version. Always 1 for a settlement. */
    sourceVersion: integer("source_version").notNull().default(1),
    reversesId: uuid("reverses_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("ledger_entries_group_member_idx").on(t.groupId, t.memberId),
    index("ledger_entries_source_idx").on(
      t.sourceType,
      t.sourceId,
      t.sourceVersion,
    ),
    /**
     * One reversal per entry, ever. Double-reversing is the corruption this
     * whole design is built to prevent, and a partial unique index makes the
     * second attempt an error rather than a silently doubled balance.
     */
    uniqueIndex("ledger_entries_reverses_unique")
      .on(t.reversesId)
      .where(sql`reverses_id is not null`),
    // A zero-cent entry is not a fact about money; the posters drop them.
    check("ledger_entries_amount_non_zero", sql`${t.amountCents} <> 0`),
    foreignKey({
      columns: [t.reversesId],
      foreignColumns: [t.id],
      name: "ledger_entries_reverses_fk",
    }).onDelete("no action"),
    foreignKey({
      columns: [t.memberId, t.groupId],
      foreignColumns: [GroupMembers.id, GroupMembers.groupId],
      name: "ledger_entries_member_fk",
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

export * from "./auth-schema";
