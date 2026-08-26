import { useTRPC } from "@/lib/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Writing an expense — a new one, or a new version of one.
 *
 * Both move money between people, so the expense list and the balances are
 * stale the moment either lands. `pathFilter` matches the plain and the
 * infinite queries alike. Navigation stays at the call site: the screen knows
 * whether it opened as a modal.
 */
export const useSaveExpense = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const onSuccess = async () => {
    await Promise.all([
      queryClient.invalidateQueries(trpc.expenses.pathFilter()),
      queryClient.invalidateQueries(trpc.balances.pathFilter()),
      // `groups.get` too: it carries `currencyLocked`, which flips the moment
      // the first entry is posted. Without this the currency picker stays open
      // and offers a save the server now refuses.
      queryClient.invalidateQueries(trpc.groups.get.pathFilter()),
    ]);
  };

  return {
    create: useMutation(trpc.expenses.create.mutationOptions({ onSuccess })),
    revise: useMutation(trpc.expenses.revise.mutationOptions({ onSuccess })),
  };
};
