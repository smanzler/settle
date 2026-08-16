/**
 * Keyset pagination over a `(date, uuid)` sort key.
 *
 * Cursors carry **both** sort keys. Encoding only the date would drop or
 * duplicate rows whenever a page boundary lands inside a busy day — and "we all
 * settled up on the 1st" is exactly that.
 *
 * The date field is called `date`, `settled_on` and `effective_date` in the
 * three tables paginated this way; the cursor format is deliberately blind to
 * which, so the wire contract stays one string in one place.
 */
const CURSOR_SEPARATOR = "|";

export type Keyset = { date: string; id: string };

const encodeCursor = (keyset: Keyset) =>
  `${keyset.date}${CURSOR_SEPARATOR}${keyset.id}`;

/** `null` for absent *and* malformed — both mean "start from the top". */
export const decodeCursor = (cursor: string | undefined): Keyset | null => {
  const [date, id] = cursor?.split(CURSOR_SEPARATOR) ?? [];

  return date && id ? { date, id } : null;
};

/**
 * Splits an over-fetched page into the page itself plus the next cursor.
 *
 * Callers `LIMIT limit + 1`: fetching one extra row is how we know there's a
 * next page without a count. `nextCursor` is null rather than `""` when there
 * isn't one — an empty string makes `getNextPageParam` loop forever.
 */
export const paginate = <R>(
  rows: R[],
  limit: number,
  toKeyset: (row: R) => Keyset,
) => {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last ? encodeCursor(toKeyset(last)) : null,
  };
};
