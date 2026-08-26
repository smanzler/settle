import { formatDayHeading } from "@/lib/date";
import type { RouterOutputs } from "@/lib/trpc";

/** One row of `expenses.list` — the shape every list component takes. */
export type Expense = RouterOutputs["expenses"]["list"]["items"][number];

export type ExpenseSection = {
  /** The raw `YYYY-MM-DD`, used as the section key. */
  date: string;
  title: string;
  /** What the group spent that day, in integer cents. */
  totalCents: number;
  data: Expense[];
};

/**
 * Groups an already date-descending list into day sections.
 *
 * Runs over the *flattened* pages so a day that straddles a page boundary
 * merges into one section instead of appearing twice. Never changes the input —
 * those arrays are the TanStack Query cache.
 *
 * `now` is only used for the headings, and is a parameter so a test can pin the
 * day that "Today" refers to.
 */
export const groupByDay = (
  expenses: Expense[],
  now = new Date(),
): ExpenseSection[] => {
  const sections = new Map<string, ExpenseSection>();

  for (const expense of expenses) {
    const section = sections.get(expense.expenseDate);

    if (section) {
      section.data.push(expense);
      // Both operands are integer cents, so the day total stays exact however
      // many rows it adds up.
      section.totalCents += expense.amountCents;
      continue;
    }

    sections.set(expense.expenseDate, {
      data: [expense],
      date: expense.expenseDate,
      title: formatDayHeading(expense.expenseDate, now),
      totalCents: expense.amountCents,
    });
  }

  // A Map keeps insertion order, and the input arrives date-descending.
  return [...sections.values()];
};
