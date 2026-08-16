import type { RouterOutputs } from "@/lib/trpc";
import { toCents } from "@budget/shared";

export type Transaction =
  RouterOutputs["transactions"]["list"]["items"][number];

export type TransactionSection = {
  /** The raw `YYYY-MM-DD`, used as the section key. */
  date: string;
  title: string;
  /** Net for the day, in Plaid's convention: positive means money went out. */
  total: number;
  currency: string | null;
  data: Transaction[];
};

const MS_PER_DAY = 86_400_000;

/**
 * `YYYY-MM-DD` → a Date at **local** midnight, or `null` if it isn't a real day.
 *
 * `new Date("2026-08-13")` parses as UTC midnight. In any UTC-negative zone
 * that is yesterday evening locally, which is how a naive implementation files
 * this evening's transactions under "Yesterday". Parse the parts by hand.
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

const startOfDay = (date: Date) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Constructing an `Intl.DateTimeFormat` is the expensive half of a
 * `toLocaleDateString` call, and `formatDayHeading` runs once per row — on the
 * pair-activity screen, which is a plain ScrollView that accumulates 50 rows per
 * "Load more" and re-renders them all. There are only three option sets in the
 * app, so they are simply kept, the way `formatCurrency` keeps its own.
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

/**
 * Today / Yesterday / weekday / `Mon D`.
 *
 * Rounds the delta between two local midnights. Do not floor elapsed
 * milliseconds: across a DST boundary a day is 23 or 25 hours, and a floor
 * lands on the wrong label.
 *
 * Weekday names rather than "N days ago" because a sticky header would
 * otherwise re-label itself as the list ages.
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

/**
 * Groups an already date-descending list into day sections.
 *
 * Runs over the *flattened* pages so a day straddling a page boundary merges
 * into one section instead of appearing twice. Never mutates the input — those
 * arrays are the TanStack Query cache.
 */
export const groupByDay = (
  transactions: Transaction[],
  now = new Date(),
): TransactionSection[] => {
  const sections = new Map<string, TransactionSection>();
  // Summed in integer cents: adding 100 floats drifts into visible pennies.
  const cents = new Map<string, number>();

  for (const transaction of transactions) {
    let section = sections.get(transaction.date);

    if (!section) {
      section = {
        date: transaction.date,
        title: formatDayHeading(transaction.date, now),
        total: 0,
        currency: transaction.isoCurrencyCode,
        data: [],
      };
      sections.set(transaction.date, section);
      cents.set(transaction.date, 0);
    }

    section.data.push(transaction);
    section.currency ??= transaction.isoCurrencyCode;

    // `toCents` rather than `Number(amount) * 100`, which is 1006.9999… for
    // "10.07". It throws on anything that is not a `numeric(12,2)`, and one bad
    // row must not poison the day total.
    try {
      cents.set(
        transaction.date,
        (cents.get(transaction.date) ?? 0) + toCents(transaction.amount),
      );
    } catch {
      // not a numeric(12,2) — leave the day's running total alone
    }
  }

  for (const section of sections.values()) {
    section.total = (cents.get(section.date) ?? 0) / 100;
  }

  // Map preserves insertion order, and the input arrives date-descending.
  return [...sections.values()];
};
