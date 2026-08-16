import { router } from "../lib/trpc";
import { balancesRouter } from "./balances";
import { householdRouter } from "./household";
import { notificationsRouter } from "./notifications";
import { plaidRouter } from "./plaid";
import { settlementsRouter } from "./settlements";
import { transactionsRouter } from "./transactions";

export const appRouter = router({
  balances: balancesRouter,
  household: householdRouter,
  notifications: notificationsRouter,
  plaid: plaidRouter,
  settlements: settlementsRouter,
  transactions: transactionsRouter,
});

export type AppRouter = typeof appRouter;
