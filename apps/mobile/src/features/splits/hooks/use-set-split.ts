import { useTRPC } from "@/lib/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Rewriting a split moves money between people, so the transaction list (which
 * carries each row's attribution) and the balances are both stale afterwards.
 */
const useInvalidateSplits = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return async () => {
    // pathFilter matches both plain and infinite queries.
    await Promise.all([
      queryClient.invalidateQueries(trpc.transactions.pathFilter()),
      queryClient.invalidateQueries(trpc.balances.pathFilter()),
    ]);
  };
};

export const useSetSplit = () => {
  const trpc = useTRPC();
  const onSuccess = useInvalidateSplits();

  return useMutation(trpc.transactions.setSplit.mutationOptions({ onSuccess }));
};

/** The "Just me" shortcut — the whole amount back onto whoever paid. */
export const useResetSplit = () => {
  const trpc = useTRPC();
  const onSuccess = useInvalidateSplits();

  return useMutation(
    trpc.transactions.resetSplit.mutationOptions({ onSuccess }),
  );
};
