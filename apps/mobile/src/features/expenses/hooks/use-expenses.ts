import { buildLoadMore } from "@/lib/query";
import { useTRPC } from "@/lib/trpc";
import { useInfiniteQuery } from "@tanstack/react-query";
import { groupByDay } from "../lib/by-day";

const PAGE_SIZE = 30;

/**
 * The active group's expenses, newest first, in day sections.
 *
 * `sections` is what a SectionList takes, and it is grouped from the flattened
 * pages so a day that straddles a page boundary stays one section. Hand
 * `loadMore` to `onEndReached`.
 */
export const useExpenses = () => {
  const trpc = useTRPC();

  const query = useInfiniteQuery(
    trpc.expenses.list.infiniteQueryOptions(
      // No `cursor` here — tRPC injects it per page.
      { limit: PAGE_SIZE },
      { getNextPageParam: (lastPage) => lastPage.nextCursor },
    ),
  );

  const expenses = query.data?.pages.flatMap((page) => page.items) ?? [];
  const sections = groupByDay(expenses);

  const loadMore = buildLoadMore(query);

  return { loadMore, query, sections };
};
