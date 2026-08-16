import { useTRPC } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/**
 * What disconnecting this bank would cost: how many transactions it brought in,
 * and how much debt its rows raised.
 *
 * Queried before the destructive path is offered, because `purge` is the one
 * irreversible action in the app and "delete my data" is a very different
 * sentence when the data is 800 transactions carrying $340 of live debt.
 */
export const useItemImpact = (itemId: string | null) => {
  const trpc = useTRPC();

  return useQuery(
    trpc.plaid.items.impact.queryOptions(
      { itemId: itemId ?? "" },
      { enabled: Boolean(itemId) },
    ),
  );
};

/**
 * Permanently deletes the connection and everything it synced.
 *
 * Debts survive on purpose — the ledger keeps its own frozen copy of each
 * amount, memo and date — but the transactions behind them do not.
 */
export const usePurgePlaidItem = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.plaid.items.purge.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.plaid.pathFilter()),
          queryClient.invalidateQueries(trpc.transactions.list.pathFilter()),
          // Entries detach from their transactions rather than disappearing, so
          // the activity feed changes shape even though no balance moves.
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
        ]);
      },
    }),
  );
};

/**
 * Revokes the connection at Plaid and drops the stored credential — a **soft**
 * disconnect that keeps every account and transaction. `purge` is the
 * destructive one.
 */
export const useRemovePlaidItem = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.plaid.items.remove.mutationOptions({
      onSuccess: async () => {
        // pathFilter matches both plain and infinite queries.
        await Promise.all([
          queryClient.invalidateQueries(trpc.plaid.pathFilter()),
          queryClient.invalidateQueries(trpc.transactions.list.pathFilter()),
        ]);
      },
    }),
  );
};
