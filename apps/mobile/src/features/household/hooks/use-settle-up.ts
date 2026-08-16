import { useTRPC } from "@/lib/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Records "I paid you back". Nothing here moves real money — it is a claim about
 * money that already moved outside the app.
 *
 * The payoff is one negative ledger row, so both the pair balance and every
 * activity feed it appears in are stale the moment this lands.
 */
export const useSettleUp = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.settlements.create.mutationOptions({
      onSuccess: async () => {
        // pathFilter matches both plain and infinite queries.
        await Promise.all([
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
          queryClient.invalidateQueries(trpc.settlements.pathFilter()),
        ]);
      },
    }),
  );
};
