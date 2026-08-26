import {
  formatDayHeading,
  formatIsoDate,
  isIsoDate,
  parseLocalDate,
  todayIsoDate,
} from "./date";

// A UTC-negative zone is the whole point of these tests: parsing a
// `YYYY-MM-DD` as UTC lands on the *previous* local day for most of the
// evening, and under UTC that bug is invisible. The zone is pinned by the
// `test` script — setting process.env.TZ inside this file is too late, because
// imports are hoisted above it.
test("runs in a UTC-negative timezone", () => {
  expect(new Date(2026, 7, 12).getTimezoneOffset()).toBeGreaterThan(0);
});

describe("parseLocalDate", () => {
  test("parses at local midnight, not UTC midnight", () => {
    const parsed = parseLocalDate("2026-08-12");

    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(7);
    expect(parsed?.getDate()).toBe(12);
    expect(parsed?.getHours()).toBe(0);
  });

  test("rejects a day that does not exist", () => {
    // The Date constructor rolls 2026-02-31 over to March 3 rather than
    // failing, so the round-trip is the only thing that catches it.
    expect(parseLocalDate("2026-02-31")).toBeNull();
  });

  test("rejects anything that is not YYYY-MM-DD", () => {
    expect(parseLocalDate("2026-8-12")).toBeNull();
    expect(parseLocalDate("12/08/2026")).toBeNull();
    expect(parseLocalDate("")).toBeNull();
  });
});

describe("todayIsoDate", () => {
  test("names the local day, not the UTC one", () => {
    // 23:00 local on the 12th is already the 13th in UTC.
    expect(todayIsoDate(new Date(2026, 7, 12, 23, 0, 0))).toBe("2026-08-12");
  });

  test("pads month and day", () => {
    expect(todayIsoDate(new Date(2026, 0, 5, 12, 0, 0))).toBe("2026-01-05");
  });
});

describe("isIsoDate", () => {
  test("accepts a real day and refuses one that rolls over", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-31")).toBe(false);
  });
});

describe("formatIsoDate", () => {
  test("reads the local day", () => {
    expect(formatIsoDate("2026-08-12")).toBe("Aug 12, 2026");
  });

  test("falls back to the raw value for an unparseable date", () => {
    expect(formatIsoDate("nonsense")).toBe("nonsense");
  });
});

describe("formatDayHeading", () => {
  test("late evening in a UTC-negative zone still says Today", () => {
    // 23:00 local is already tomorrow in UTC. Parsing the date as UTC would
    // make today's expenses look ~30h old and render as "Yesterday".
    const now = new Date(2026, 7, 12, 23, 0, 0);
    expect(formatDayHeading("2026-08-12", now)).toBe("Today");
  });

  test("late evening in a UTC-negative zone still says Yesterday", () => {
    const now = new Date(2026, 7, 12, 23, 0, 0);
    expect(formatDayHeading("2026-08-11", now)).toBe("Yesterday");
  });

  test("just after local midnight says Today", () => {
    const now = new Date(2026, 7, 12, 0, 30, 0);
    expect(formatDayHeading("2026-08-12", now)).toBe("Today");
  });

  test("a 23-hour spring-forward day is still one day", () => {
    // US DST starts 2026-03-08; 2026-03-07 → 2026-03-08 is 23 hours long.
    const now = new Date(2026, 2, 8, 12, 0, 0);
    expect(formatDayHeading("2026-03-07", now)).toBe("Yesterday");
  });

  test("a 25-hour fall-back day is still one day", () => {
    // US DST ends 2026-11-01; 2026-10-31 → 2026-11-01 is 25 hours long.
    const now = new Date(2026, 10, 1, 12, 0, 0);
    expect(formatDayHeading("2026-10-31", now)).toBe("Yesterday");
  });

  test("uses the weekday name inside the last week", () => {
    const now = new Date(2026, 7, 12, 12, 0, 0); // Wednesday
    expect(formatDayHeading("2026-08-09", now)).toBe("Sunday");
  });

  test("uses month and day beyond a week", () => {
    const now = new Date(2026, 7, 12, 12, 0, 0);
    expect(formatDayHeading("2026-07-04", now)).toBe("Jul 4");
  });

  test("includes the year when it is not the current year", () => {
    const now = new Date(2026, 7, 12, 12, 0, 0);
    expect(formatDayHeading("2025-12-25", now)).toBe("Dec 25, 2025");
  });

  test("falls back to the raw value for an unparseable date", () => {
    expect(formatDayHeading("nonsense")).toBe("nonsense");
  });
});
