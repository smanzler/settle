import { router } from "../lib/trpc";
import { balancesRouter } from "./balances";
import { expensesRouter } from "./expenses";
import { groupsRouter } from "./groups";
import { notificationsRouter } from "./notifications";
import { settlementsRouter } from "./settlements";

export const appRouter = router({
  balances: balancesRouter,
  expenses: expensesRouter,
  groups: groupsRouter,
  notifications: notificationsRouter,
  settlements: settlementsRouter,
});

export type AppRouter = typeof appRouter;
