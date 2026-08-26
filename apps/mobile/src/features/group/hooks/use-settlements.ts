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
 * Every repayment recorded in this group, newest first.
 *
 * Group-wide rather than per member on purpose: a settlement is a claim one
 * person makes about money that moved outside the app, so the value of the list
 * is that you can read the ones you were not part of too.
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

  return { loadMore, query, settlements };
};

/**
 * Records "I paid you back". Nothing here moves real money — it is a claim
 * about money that already moved outside the app.
 *
 * `settlementId` is the idempotency key the API dedupes on, so the caller mints
 * one id per attempt and sends that same id on every retry of it.
 *
 * The payoff is two ledger entries, which is why this invalidates the balances
 * as well: every net position and the transfer suggestion built from them are
 * stale the moment it lands.
 */
export const useRecordSettlement = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.settlements.create.mutationOptions({
      onSuccess: async () => {
        // pathFilter matches both plain and infinite queries.
        await Promise.all([
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
          queryClient.invalidateQueries(trpc.settlements.pathFilter()),
          // A settlement posts entries, so `currencyLocked` on `groups.get`
          // flips with the first one.
          queryClient.invalidateQueries(trpc.groups.get.pathFilter()),
        ]);
      },
    }),
  );
};

/**
 * Takes a repayment back.
 *
 * The void is soft on the settlement and appended on the ledger, so the row
 * stays visible as struck through rather than vanishing — which is why this
 * invalidates the list as well as the balances.
 */
export const useVoidSettlement = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.settlements.void.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
          queryClient.invalidateQueries(trpc.settlements.pathFilter()),
        ]);
      },
    }),
  );
};
