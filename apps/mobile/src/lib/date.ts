const MS_PER_DAY = 86_400_000;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * `YYYY-MM-DD` → a Date at **local** midnight, or `null` if it isn't a real day.
 *
 * `new Date("2026-08-13")` parses as UTC midnight. In any UTC-negative zone that
 * is yesterday evening locally, which is how a naive implementation files this
 * evening's expenses under "Yesterday". Parse the parts by hand.
 *
 * The round-trip is what rejects a typo'd `2026-02-31`: the Date constructor
 * rolls it over to March 3 rather than failing, so comparing the fields back is
 * the only way to tell a real date from a rolled-over one.
 */
export const parseLocalDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  return date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day)
    ? date
    : null;
};

/**
 * Today as `YYYY-MM-DD` in the device's timezone — the shape every `date` column
 * round-trips. `toISOString()` is UTC, which is the wrong day for most of the
 * planet for part of every day.
 */
export const todayIsoDate = (now = new Date()): string =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

/**
 * A real calendar date in `YYYY-MM-DD`, which is all `z.iso.date()` accepts.
 * `parseLocalDate` already round-trips through `Date`, which is what rejects a
 * typo'd `2026-02-31` here rather than as a 400 after the user taps.
 */
export const isIsoDate = (value: string): boolean =>
  parseLocalDate(value) !== null;

/** `2026-08-13` → `Aug 13, 2026`, in the device's timezone. */
export const formatIsoDate = (value: string): string =>
  parseLocalDate(value)?.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) ?? value;

/**
 * Constructing an `Intl.DateTimeFormat` is the expensive half of a
 * `toLocaleDateString` call, and `formatDayHeading` runs once per row. There are
 * only a couple of option sets in the app, so they are simply kept, the way
 * `formatCurrency` keeps its own.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

const dateFormatter = (options: Intl.DateTimeFormatOptions) => {
  const key = JSON.stringify(options);
  const cached = formatters.get(key);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat("en-US", options);
  formatters.set(key, formatter);

  return formatter;
};

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Today / Yesterday / weekday / `Mon D`.
 *
 * Rounds the delta between two local midnights. Do not floor elapsed
 * milliseconds: across a DST boundary a day is 23 or 25 hours, and a floor lands
 * on the wrong label.
 *
 * Weekday names rather than "N days ago" because a sticky header would otherwise
 * re-label itself as the list ages.
 */
export const formatDayHeading = (date: string, now = new Date()): string => {
  const parsed = parseLocalDate(date);
  if (!parsed) return date;

  const delta = Math.round(
    (startOfDay(now).getTime() - startOfDay(parsed).getTime()) / MS_PER_DAY,
  );

  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";

  if (delta > 1 && delta < 7) {
    return dateFormatter({ weekday: "long" }).format(parsed);
  }

  return dateFormatter({
    month: "short",
    day: "numeric",
    ...(parsed.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  }).format(parsed);
};
