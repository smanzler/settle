import db from "./index";
import * as schema from "./schema";
import { reset, seed } from "drizzle-seed";

const main = async () => {
  await reset(db, schema);
  // Every table needs an entry: drizzle-seed fills anything it isn't told
  // about, and the household tables are a web of NOT NULL composite FKs that
  // random data cannot satisfy. Seeded users get their household lazily from
  // `householdProcedure` on first request — drizzle-seed writes rows directly
  // and never runs better-auth's signup hook.
  await seed(db, schema).refine(() => ({
    BankAccounts: { count: 0 },
    HouseholdInvites: { count: 0 },
    HouseholdMembers: { count: 0 },
    Households: { count: 0 },
    LedgerEntries: { count: 0 },
    NotificationDeliveries: { count: 0 },
    Notifications: { count: 0 },
    PlaidItems: { count: 0 },
    PushTokens: { count: 0 },
    Settlements: { count: 0 },
    SplitIntents: { count: 0 },
    TransactionSplits: { count: 0 },
    Transactions: { count: 0 },
    UserHouseholdPrefs: { count: 0 },
    accounts: { count: 0 },
    sessions: { count: 0 },
    users: { count: 10 },
    verifications: { count: 0 },
  }));
};

main();
