import { parseLocalDate } from "@/features/transactions/lib/group";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Today as `YYYY-MM-DD` in the device's timezone — the shape `settledOn` takes.
 * `toISOString()` is UTC, which is the wrong day for most of the planet for part
 * of every day.
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
