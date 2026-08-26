import { groupByDay, type Expense } from "./by-day";

// Pinned so the headings do not move with the calendar. The zone itself is
// pinned by the `test` script — a UTC-negative zone is where a date parsed as
// UTC lands on the previous local day.
const NOW = new Date(2026, 7, 12, 12, 0, 0);

const YOU = {
  id: "m1",
  displayName: "You",
  isYou: true,
  status: "active",
} as const;

const ALEX = {
  id: "m2",
  displayName: "Alex",
  isYou: false,
  status: "active",
} as const;

// Spelled out in full rather than cast: a cast would hide any field the wire
// type gains.
const BASE: Expense = {
  id: "e1",
  version: 1,
  amountCents: 1000,
  description: "Coffee",
  expenseDate: "2026-08-12",
  createdAt: "2026-08-12T17:00:00.000Z",
  payers: [{ ...YOU, amountCents: 1000 }],
  participants: [YOU, ALEX],
  yourNetCents: 500,
};

const expense = (overrides: Partial<Expense>): Expense => ({
  ...BASE,
  ...overrides,
});

describe("groupByDay", () => {
  test("merges a day that straddles a page boundary", () => {
    // What two pages of `expenses.list` flatten to: the 12th ends one page and
    // starts the next, and must still read as one day.
    const pageOne = [
      expense({ id: "e1", expenseDate: "2026-08-13" }),
      expense({ id: "e2", expenseDate: "2026-08-12" }),
    ];
    const pageTwo = [
      expense({ id: "e3", expenseDate: "2026-08-12" }),
      expense({ id: "e4", expenseDate: "2026-08-11" }),
    ];

    const sections = groupByDay([...pageOne, ...pageTwo], NOW);

    expect(sections.map((section) => section.date)).toEqual([
      "2026-08-13",
      "2026-08-12",
      "2026-08-11",
    ]);
    expect(sections[1].data.map((item) => item.id)).toEqual(["e2", "e3"]);
    expect(sections.map((section) => section.title)).toEqual([
      "Aug 13",
      "Today",
      "Yesterday",
    ]);
  });

  test("totals a day in integer cents", () => {
    const sections = groupByDay(
      [
        expense({ id: "e1", amountCents: 1007 }),
        expense({ id: "e2", amountCents: 3 }),
        expense({ id: "e3", amountCents: 999 }),
      ],
      NOW,
    );

    expect(sections).toHaveLength(1);
    // 10.07 + 0.03 + 9.99 in floats is 20.089999999999996, which is how a day
    // total drifts into a visible penny.
    expect(sections[0].totalCents).toBe(2009);
    expect(Number.isInteger(sections[0].totalCents)).toBe(true);
  });

  test("does not change the array it was given", () => {
    const page = [expense({ id: "e1" }), expense({ id: "e2" })];

    groupByDay(page, NOW);

    expect(page.map((item) => item.id)).toEqual(["e1", "e2"]);
  });

  test("gives an empty list no sections", () => {
    expect(groupByDay([], NOW)).toEqual([]);
  });
});
