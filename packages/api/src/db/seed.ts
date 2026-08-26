import db from "./index";
import * as schema from "./schema";
import { reset, seed } from "drizzle-seed";

const main = async () => {
  await reset(db, schema);
  // Every table needs an entry: drizzle-seed fills anything it isn't told
  // about, and the group tables are a web of NOT NULL composite FKs that random
  // data cannot satisfy. Seeded users get their group lazily from
  // `groupProcedure` on first request — drizzle-seed writes rows directly and
  // never runs better-auth's signup hook.
  await seed(db, schema).refine(() => ({
    ExpensePayers: { count: 0 },
    ExpenseShares: { count: 0 },
    ExpenseVersions: { count: 0 },
    Expenses: { count: 0 },
    GroupInvites: { count: 0 },
    GroupMembers: { count: 0 },
    Groups: { count: 0 },
    LedgerEntries: { count: 0 },
    NotificationDeliveries: { count: 0 },
    Notifications: { count: 0 },
    PushTokens: { count: 0 },
    Settlements: { count: 0 },
    UserGroupPrefs: { count: 0 },
    accounts: { count: 0 },
    sessions: { count: 0 },
    users: { count: 10 },
    verifications: { count: 0 },
  }));
};

main();
