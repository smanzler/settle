import { useTRPC } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * One expense, as it stands now.
 *
 * The id comes straight off the URL, so a malformed one is left to the server
 * to reject — the screen renders that as an error rather than guessing. A
 * deleted expense still answers here, with `deletedAt` set.
 */
export const useExpense = (expenseId: string) => {
  const trpc = useTRPC();

  return useQuery(trpc.expenses.get.queryOptions({ expenseId }));
};

/**
 * Every version of an expense, oldest first.
 *
 * `enabled` is the point of the hook, not a refinement: the history is one row
 * per revision behind a collapsed section, so nothing asks for it until
 * somebody opens that section.
 */
export const useExpenseHistory = (
  expenseId: string,
  { enabled }: { enabled: boolean },
) => {
  const trpc = useTRPC();

  return useQuery(
    trpc.expenses.history.queryOptions({ expenseId }, { enabled }),
  );
};

/**
 * Deletes an expense.
 *
 * The server reverses the ledger rather than erasing the rows, so the expense
 * lists and every balance are both stale the moment this lands.
 */
export const useDeleteExpense = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.expenses.delete.mutationOptions({
      onSuccess: async () => {
        // pathFilter matches both plain and infinite queries.
        await Promise.all([
          queryClient.invalidateQueries(trpc.expenses.pathFilter()),
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
        ]);
      },
    }),
  );
};
