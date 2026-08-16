/** The shape of an infinite query that the paging helpers below need. */
type Pageable = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => unknown;
};

/**
 * A "fetch the next page" handler safe to hand straight to `onEndReached`, which
 * fires spuriously — including on an empty list — and to a Load more button that
 * a user can tap twice.
 */
export const buildLoadMore = (query: Pageable) => () => {
  if (query.hasNextPage && !query.isFetchingNextPage) {
    void query.fetchNextPage();
  }
};
