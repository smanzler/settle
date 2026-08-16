import { buildLoadMore } from "@/lib/query";
import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

export type Settlement = RouterOutputs["settlements"]["list"]["items"][number];

const PAGE_SIZE = 50;

/**
 * Every repayment recorded in this household, newest first.
 *
 * Household-wide rather than per pair on purpose: a settlement is a claim one
 * person makes about money that moved outside the app, so the value of the list
 * is being able to see the ones you were not part of too.
 */
export const useSettlements = () => {
  const trpc = useTRPC();

  const query = useInfiniteQuery(
    trpc.settlements.list.infiniteQueryOptions(
      // No `cursor` — tRPC injects it per page.
      { limit: PAGE_SIZE },
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ),
  );

  const settlements = query.data?.pages.flatMap((page) => page.items) ?? [];

  const loadMore = buildLoadMore(query);

  return { query, settlements, loadMore };
};

/**
 * Takes a repayment back.
 *
 * The void is soft on the settlement and appended on the ledger, so the row
 * stays visible as struck through rather than vanishing — which is why this
 * invalidates the lists as well as the balances.
 */
export const useVoidSettlement = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.settlements.void.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.settlements.pathFilter()),
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
        ]);
      },
    }),
  );
};
