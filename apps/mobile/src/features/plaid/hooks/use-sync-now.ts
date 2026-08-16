import { useTRPC } from "@/lib/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/** Runs a sync and waits for it, then refreshes everything it could have changed. */
export const useSyncNow = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.plaid.syncNow.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.plaid.items.list.pathFilter()),
          queryClient.invalidateQueries(trpc.transactions.list.pathFilter()),
        ]);
      },
    }),
  );
};
