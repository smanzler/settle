import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  Households: {
    createdBy: r.one.users({
      from: r.Households.createdByUserId,
      to: r.users.id,
    }),
    members: r.many.HouseholdMembers({
      from: r.Households.id,
      to: r.HouseholdMembers.householdId,
    }),
    invites: r.many.HouseholdInvites({
      from: r.Households.id,
      to: r.HouseholdInvites.householdId,
    }),
    bankAccounts: r.many.BankAccounts({
      from: r.Households.id,
      to: r.BankAccounts.householdId,
    }),
    transactions: r.many.Transactions({
      from: r.Households.id,
      to: r.Transactions.householdId,
    }),
  },
  UserHouseholdPrefs: {
    user: r.one.users({
      from: r.UserHouseholdPrefs.userId,
      to: r.users.id,
    }),
    activeHousehold: r.one.Households({
      from: r.UserHouseholdPrefs.activeHouseholdId,
      to: r.Households.id,
    }),
  },
  HouseholdMembers: {
    household: r.one.Households({
      from: r.HouseholdMembers.householdId,
      to: r.Households.id,
    }),
    /** Null until the seat's invite is accepted. */
    user: r.one.users({
      from: r.HouseholdMembers.userId,
      to: r.users.id,
    }),
  },
  HouseholdInvites: {
    household: r.one.Households({
      from: r.HouseholdInvites.householdId,
      to: r.Households.id,
    }),
    member: r.one.HouseholdMembers({
      from: r.HouseholdInvites.memberId,
      to: r.HouseholdMembers.id,
    }),
    invitedBy: r.one.HouseholdMembers({
      from: r.HouseholdInvites.invitedByMemberId,
      to: r.HouseholdMembers.id,
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
  PlaidItems: {
    household: r.one.Households({
      from: r.PlaidItems.householdId,
      to: r.Households.id,
    }),
    /** The credential holder, not the creditor. */
    user: r.one.users({
      from: r.PlaidItems.userId,
      to: r.users.id,
    }),
    owner: r.one.HouseholdMembers({
      from: r.PlaidItems.ownerMemberId,
      to: r.HouseholdMembers.id,
    }),
    accounts: r.many.BankAccounts({
      from: r.PlaidItems.id,
      to: r.BankAccounts.plaidItemId,
    }),
  },
  BankAccounts: {
    household: r.one.Households({
      from: r.BankAccounts.householdId,
      to: r.Households.id,
    }),
    owner: r.one.HouseholdMembers({
      from: r.BankAccounts.ownerMemberId,
      to: r.HouseholdMembers.id,
    }),
    plaidItem: r.one.PlaidItems({
      from: r.BankAccounts.plaidItemId,
      to: r.PlaidItems.id,
    }),
    transactions: r.many.Transactions({
      from: r.BankAccounts.id,
      to: r.Transactions.bankAccountId,
    }),
  },
  Transactions: {
    household: r.one.Households({
      from: r.Transactions.householdId,
      to: r.Households.id,
    }),
    creditor: r.one.HouseholdMembers({
      from: r.Transactions.creditorMemberId,
      to: r.HouseholdMembers.id,
    }),
    bankAccount: r.one.BankAccounts({
      from: r.Transactions.bankAccountId,
      to: r.BankAccounts.id,
    }),
    splits: r.many.TransactionSplits({
      from: r.Transactions.id,
      to: r.TransactionSplits.transactionId,
    }),
  },
  TransactionSplits: {
    transaction: r.one.Transactions({
      from: r.TransactionSplits.transactionId,
      to: r.Transactions.id,
    }),
    member: r.one.HouseholdMembers({
      from: r.TransactionSplits.memberId,
      to: r.HouseholdMembers.id,
    }),
  },
  Settlements: {
    household: r.one.Households({
      from: r.Settlements.householdId,
      to: r.Households.id,
    }),
    from: r.one.HouseholdMembers({
      from: r.Settlements.fromMemberId,
      to: r.HouseholdMembers.id,
    }),
    to: r.one.HouseholdMembers({
      from: r.Settlements.toMemberId,
      to: r.HouseholdMembers.id,
    }),
  },
  LedgerEntries: {
    household: r.one.Households({
      from: r.LedgerEntries.householdId,
      to: r.Households.id,
    }),
    debtor: r.one.HouseholdMembers({
      from: r.LedgerEntries.debtorMemberId,
      to: r.HouseholdMembers.id,
    }),
    creditor: r.one.HouseholdMembers({
      from: r.LedgerEntries.creditorMemberId,
      to: r.HouseholdMembers.id,
    }),
    /** Null once Plaid removed the row, or the item was purged. */
    transaction: r.one.Transactions({
      from: r.LedgerEntries.transactionId,
      to: r.Transactions.id,
    }),
    settlement: r.one.Settlements({
      from: r.LedgerEntries.settlementId,
      to: r.Settlements.id,
    }),
  },
  SplitIntents: {
    household: r.one.Households({
      from: r.SplitIntents.householdId,
      to: r.Households.id,
    }),
  },
}));
