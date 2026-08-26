import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  Groups: {
    createdBy: r.one.users({
      from: r.Groups.createdByUserId,
      to: r.users.id,
    }),
    members: r.many.GroupMembers({
      from: r.Groups.id,
      to: r.GroupMembers.groupId,
    }),
    invites: r.many.GroupInvites({
      from: r.Groups.id,
      to: r.GroupInvites.groupId,
    }),
    expenses: r.many.Expenses({
      from: r.Groups.id,
      to: r.Expenses.groupId,
    }),
  },
  UserGroupPrefs: {
    user: r.one.users({
      from: r.UserGroupPrefs.userId,
      to: r.users.id,
    }),
    activeGroup: r.one.Groups({
      from: r.UserGroupPrefs.activeGroupId,
      to: r.Groups.id,
    }),
  },
  GroupMembers: {
    group: r.one.Groups({
      from: r.GroupMembers.groupId,
      to: r.Groups.id,
    }),
    /** Null until the seat's invite is accepted. */
    user: r.one.users({
      from: r.GroupMembers.userId,
      to: r.users.id,
    }),
  },
  GroupInvites: {
    group: r.one.Groups({
      from: r.GroupInvites.groupId,
      to: r.Groups.id,
    }),
    member: r.one.GroupMembers({
      from: r.GroupInvites.memberId,
      to: r.GroupMembers.id,
    }),
    invitedBy: r.one.GroupMembers({
      from: r.GroupInvites.invitedByMemberId,
      to: r.GroupMembers.id,
    }),
  },
  Expenses: {
    group: r.one.Groups({
      from: r.Expenses.groupId,
      to: r.Groups.id,
    }),
    createdBy: r.one.GroupMembers({
      from: r.Expenses.createdByMemberId,
      to: r.GroupMembers.id,
    }),
    versions: r.many.ExpenseVersions({
      from: r.Expenses.id,
      to: r.ExpenseVersions.expenseId,
    }),
  },
  ExpenseVersions: {
    expense: r.one.Expenses({
      from: r.ExpenseVersions.expenseId,
      to: r.Expenses.id,
    }),
    createdBy: r.one.GroupMembers({
      from: r.ExpenseVersions.createdByMemberId,
      to: r.GroupMembers.id,
    }),
    payers: r.many.ExpensePayers({
      from: r.ExpenseVersions.id,
      to: r.ExpensePayers.expenseVersionId,
    }),
    shares: r.many.ExpenseShares({
      from: r.ExpenseVersions.id,
      to: r.ExpenseShares.expenseVersionId,
    }),
  },
  ExpensePayers: {
    version: r.one.ExpenseVersions({
      from: r.ExpensePayers.expenseVersionId,
      to: r.ExpenseVersions.id,
    }),
    member: r.one.GroupMembers({
      from: r.ExpensePayers.memberId,
      to: r.GroupMembers.id,
    }),
  },
  ExpenseShares: {
    version: r.one.ExpenseVersions({
      from: r.ExpenseShares.expenseVersionId,
      to: r.ExpenseVersions.id,
    }),
    member: r.one.GroupMembers({
      from: r.ExpenseShares.memberId,
      to: r.GroupMembers.id,
    }),
  },
  Settlements: {
    group: r.one.Groups({
      from: r.Settlements.groupId,
      to: r.Groups.id,
    }),
    from: r.one.GroupMembers({
      from: r.Settlements.fromMemberId,
      to: r.GroupMembers.id,
    }),
    to: r.one.GroupMembers({
      from: r.Settlements.toMemberId,
      to: r.GroupMembers.id,
    }),
    createdBy: r.one.GroupMembers({
      from: r.Settlements.createdByMemberId,
      to: r.GroupMembers.id,
    }),
  },
  LedgerEntries: {
    group: r.one.Groups({
      from: r.LedgerEntries.groupId,
      to: r.Groups.id,
    }),
    member: r.one.GroupMembers({
      from: r.LedgerEntries.memberId,
      to: r.GroupMembers.id,
    }),
  },
  Notifications: {
    user: r.one.users({
      from: r.Notifications.userId,
      to: r.users.id,
    }),
    deliveries: r.many.NotificationDeliveries({
      from: r.Notifications.id,
      to: r.NotificationDeliveries.notificationId,
    }),
  },
  NotificationDeliveries: {
    notification: r.one.Notifications({
      from: r.NotificationDeliveries.notificationId,
      to: r.Notifications.id,
    }),
  },
  PushTokens: {
    user: r.one.users({
      from: r.PushTokens.userId,
      to: r.users.id,
    }),
  },
}));
