import { buildLoadMore } from "@/lib/query";
import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useHousehold } from "./use-household";

export type ActivityEntry =
  RouterOutputs["balances"]["activity"]["items"][number];

const PAGE_SIZE = 50;

/** Who owes whom, plus the two hero figures the server keeps separate. */
export const useBalances = () => {
  const trpc = useTRPC();

  const query = useQuery(trpc.balances.summary.queryOptions());
  // The same `household.get` the protected layout already holds, so this is a
  // cache read rather than a second request — and the one definition of
  // "shared" in the app, which a retired seat does not count towards.
  const { isShared } = useHousehold();

  return {
    query,
    pairs: query.data?.pairs ?? [],
    owedToYou: query.data?.you.owedToYou ?? [],
    youOwe: query.data?.you.youOwe ?? [],
    pending: query.data?.pending ?? [],
    currency: query.data?.currency ?? null,
    isShared,
  };
};

/**
 * The other party on a pair screen.
 *
 * Resolved against `household.get` rather than the summary: a pair that has
 * netted to zero drops out of `pairs` entirely, and its history is exactly what
 * somebody opening that screen came to read. Removed seats are in there too.
 */
export const usePairMember = (memberId: string) => {
  const trpc = useTRPC();
  // Deliberately the raw query rather than `useHousehold`, whose `members` drops
  // removed seats — this screen has to be able to name one.
  const query = useQuery(trpc.household.get.queryOptions());

  return query.data?.members.find((seat) => seat.id === memberId) ?? null;
};

/** Every ledger entry between you and one member, newest first. */
export const usePairActivity = (memberId: string) => {
  const trpc = useTRPC();

  const query = useInfiniteQuery(
    trpc.balances.activity.infiniteQueryOptions(
      // No `cursor` here — tRPC injects it per page.
      { memberId, limit: PAGE_SIZE },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        // The route always carries one, but a missing param would otherwise
        // spend a request to be told it isn't a uuid.
        enabled: Boolean(memberId),
      },
    ),
  );

  const entries = query.data?.pages.flatMap((page) => page.items) ?? [];

  const loadMore = buildLoadMore(query);

  return { query, entries, loadMore };
};
