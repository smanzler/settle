import { formatDayHeading, groupByDay, type Transaction } from "./group";

// A UTC-negative zone is the whole point of the heading tests: parsing a
// `YYYY-MM-DD` as UTC lands on the *previous* local day for most of the
// evening, and under UTC that bug is invisible. The zone is pinned by the
// `test` script — setting process.env.TZ inside this file is too late, because
// imports are hoisted above it.
test("runs in a UTC-negative timezone", () => {
  expect(new Date(2026, 7, 12).getTimezoneOffset()).toBeGreaterThan(0);
});

// Spelled out in full rather than cast: a cast would hide any field the wire
// type gains, and `formatAttribution` reads three of them.
const BASE: Transaction = {
  id: "t1",
  amount: "10.00",
  isoCurrencyCode: "USD",
  date: "2026-08-12",
  name: "Coffee",
  merchantName: null,
  category: null,
  categoryDetailed: null,
  pending: false,
  logoUrl: null,
  bankAccountId: "a1",
  accountName: "Sapphire",
  accountMask: "4242",
  creditorMemberId: "m1",
  splitMethod: "owner",
  splitsStale: false,
  yourShare: null,
  participants: [],
};

const tx = (overrides: Partial<Transaction>): Transaction => ({
  ...BASE,
  ...overrides,
});

describe("formatDayHeading", () => {
  test("late evening in a UTC-negative zone still says Today", () => {
    // 23:00 local is already tomorrow in UTC. Parsing the date as UTC would
    // make today's transactions look ~30h old and render as "Yesterday".
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

describe("groupByDay", () => {
  const now = new Date(2026, 7, 12, 12, 0, 0);

  test("merges a day split across two pages into one section", () => {
    // Exactly what happens when a page boundary lands mid-day.
    const pageOne = [tx({ id: "a", date: "2026-08-12" })];
    const pageTwo = [
      tx({ id: "b", date: "2026-08-12" }),
      tx({ id: "c", date: "2026-08-11" }),
    ];

    const sections = groupByDay([...pageOne, ...pageTwo], now);

    expect(sections).toHaveLength(2);
    expect(sections[0]?.data.map((t) => t.id)).toEqual(["a", "b"]);
    expect(sections[1]?.data.map((t) => t.id)).toEqual(["c"]);
  });

  test("preserves the date-descending order it was given", () => {
    const sections = groupByDay(
      [
        tx({ id: "a", date: "2026-08-12" }),
        tx({ id: "b", date: "2026-08-10" }),
        tx({ id: "c", date: "2026-08-11" }),
      ],
      now,
    );

    expect(sections.map((s) => s.date)).toEqual([
      "2026-08-12",
      "2026-08-10",
      "2026-08-11",
    ]);
  });

  test("sums the day total without float drift", () => {
    // 0.1 + 0.2 === 0.30000000000000004 if summed as floats.
    const sections = groupByDay(
      [
        tx({ id: "a", amount: "0.10" }),
        tx({ id: "b", amount: "0.20" }),
        tx({ id: "c", amount: "0.30" }),
      ],
      now,
    );

    expect(sections[0]?.total).toBe(0.6);
  });

  test("nets inflows against outflows in the day total", () => {
    const sections = groupByDay(
      [tx({ id: "a", amount: "50.00" }), tx({ id: "b", amount: "-20.00" })],
      now,
    );

    expect(sections[0]?.total).toBe(30);
  });

  test("skips non-numeric amounts instead of poisoning the total with NaN", () => {
    const sections = groupByDay(
      [tx({ id: "a", amount: "10.00" }), tx({ id: "b", amount: "oops" })],
      now,
    );

    expect(sections[0]?.total).toBe(10);
  });

  test("does not mutate the input array", () => {
    const input = [tx({ id: "a" }), tx({ id: "b" })];
    const snapshot = [...input];

    groupByDay(input, now);

    expect(input).toEqual(snapshot);
  });

  test("returns no sections for an empty list", () => {
    expect(groupByDay([], now)).toEqual([]);
  });
});
