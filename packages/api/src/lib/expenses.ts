import { buildShares, sumAmounts, type ExpenseInput } from "@budget/shared";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import db from "../db";
import {
  ExpensePayers,
  Expenses,
  ExpenseShares,
  ExpenseVersions,
  GroupMembers,
} from "../db/schema";
import {
  assertGroupIntegrity,
  lockExpense,
  lockGroup,
  postExpenseVersion,
  reverseExpenseVersion,
  type Tx,
} from "./ledger";

/**
 * Payers and shares each add up to the amount — checked on the rows rather than
 * on the arguments.
 *
 * `buildShares` already guarantees it for shares and the input schema for
 * payers. Restating it here is deliberate: this is the assertion that survives a
 * future caller that skips one of them.
 */
const assertSumsTo = (
  parts: readonly { amountCents: number }[],
  amountCents: number,
  context: string,
) => {
  const total = sumAmounts(parts);

  if (total !== amountCents) {
    throw new Error(
      `${context} do not add up: they sum to ${total}, the expense is ${amountCents}`,
    );
  }
};

/**
 * Everybody named on an expense has to be a seat in this group that has not been
 * retired.
 *
 * The composite foreign keys already make "a member of another group" structurally
 * impossible — that half needs no query. This covers the half they cannot: a
 * removed seat keeps its history and its id, so the database would accept new
 * debt against somebody who left.
 */
const assertSplittable = async (
  tx: Tx,
  args: { groupId: string; memberIds: readonly string[] },
) => {
  const memberIds = [...new Set(args.memberIds)];

  const seats = await tx
    .select({
      displayName: GroupMembers.displayName,
      id: GroupMembers.id,
      status: GroupMembers.status,
    })
    .from(GroupMembers)
    .where(
      and(
        eq(GroupMembers.groupId, args.groupId),
        inArray(GroupMembers.id, memberIds),
      ),
    );

  if (seats.length !== memberIds.length) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Somebody on this expense is not a member of the group",
    });
  }

  const retired = seats.find((seat) => seat.status === "removed");

  if (retired) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${retired.displayName} has left the group, so they can't be on new expenses.`,
    });
  }
};

/** Inserts a version and its payer/share rows. Writes nothing to the ledger. */
const writeVersion = async (
  tx: Tx,
  args: {
    actorMemberId: string;
    expenseId: string;
    groupId: string;
    input: ExpenseInput;
    version: number;
  },
) => {
  const { groupId, input } = args;
  const shares = buildShares(input.amountCents, input.split);

  assertSumsTo(shares, input.amountCents, "shares");
  assertSumsTo(input.payers, input.amountCents, "payers");

  await assertSplittable(tx, {
    groupId,
    memberIds: [
      ...input.payers.map((payer) => payer.memberId),
      ...shares.map((share) => share.memberId),
    ],
  });

  const [version] = await tx
    .insert(ExpenseVersions)
    .values({
      amountCents: input.amountCents,
      createdByMemberId: args.actorMemberId,
      description: input.description,
      expenseDate: input.expenseDate,
      expenseId: args.expenseId,
      groupId,
      note: input.note ?? null,
      version: args.version,
    })
    .returning({ id: ExpenseVersions.id });

  if (!version) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to write the expense",
    });
  }

  await tx.insert(ExpensePayers).values(
    input.payers.map((payer) => ({
      amountCents: payer.amountCents,
      expenseVersionId: version.id,
      groupId,
      memberId: payer.memberId,
    })),
  );

  // Zero shares are stored: "they were there and owe nothing" is intent, and
  // dropping it would silently shrink the participant list on the next revision.
  // The ledger drops them; the record does not.
  await tx.insert(ExpenseShares).values(
    shares.map((share) => ({
      amountCents: share.amountCents,
      expenseVersionId: version.id,
      groupId,
      memberId: share.memberId,
    })),
  );

  return { shares, versionId: version.id };
};

export const createExpense = (args: {
  actorMemberId: string;
  groupId: string;
  input: ExpenseInput;
}) =>
  db.transaction(async (tx) => {
    await lockGroup(tx, args.groupId);

    const [expense] = await tx
      .insert(Expenses)
      .values({
        createdByMemberId: args.actorMemberId,
        currentVersion: 1,
        groupId: args.groupId,
      })
      .returning({ id: Expenses.id });

    if (!expense) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create the expense",
      });
    }

    const { shares } = await writeVersion(tx, {
      actorMemberId: args.actorMemberId,
      expenseId: expense.id,
      groupId: args.groupId,
      input: args.input,
      version: 1,
    });

    await postExpenseVersion(tx, {
      expenseId: expense.id,
      groupId: args.groupId,
      payers: args.input.payers,
      shares,
      version: 1,
    });

    await assertGroupIntegrity(tx, args.groupId);

    return { expenseId: expense.id, version: 1 };
  });

/**
 * Replaces an expense with a new version of itself.
 *
 * Reverse, then post — never update. The old version, its payers and its shares
 * all stay exactly as they were, and the ledger carries both the original
 * entries and their negations, so "what did this say in March, and who changed
 * it" is answerable forever.
 *
 * A revision states the whole expense again rather than patching fields,
 * because a version *is* the whole expense. Dropping a participant and adding
 * another needs no special handling for the same reason: the new share set
 * simply is what it is, and the old one was already reversed.
 */
export const reviseExpense = (args: {
  actorMemberId: string;
  expenseId: string;
  groupId: string;
  input: ExpenseInput;
}) =>
  db.transaction(async (tx) => {
    await lockGroup(tx, args.groupId);

    const expense = await lockExpense(tx, {
      expenseId: args.expenseId,
      groupId: args.groupId,
    });

    if (!expense) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
    }

    if (expense.deletedAt) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "This expense was deleted. Add a new one instead.",
      });
    }

    await reverseExpenseVersion(tx, {
      expenseId: args.expenseId,
      groupId: args.groupId,
      version: expense.currentVersion,
    });

    const version = expense.currentVersion + 1;

    const { shares } = await writeVersion(tx, {
      actorMemberId: args.actorMemberId,
      expenseId: args.expenseId,
      groupId: args.groupId,
      input: args.input,
      version,
    });

    await postExpenseVersion(tx, {
      expenseId: args.expenseId,
      groupId: args.groupId,
      payers: args.input.payers,
      shares,
      version,
    });

    await tx
      .update(Expenses)
      .set({ currentVersion: version })
      .where(
        and(
          eq(Expenses.id, args.expenseId),
          eq(Expenses.groupId, args.groupId),
        ),
      );

    await assertGroupIntegrity(tx, args.groupId);

    return { expenseId: args.expenseId, version };
  });

/**
 * Reverses an expense and marks it gone. Nothing is deleted.
 *
 * Idempotent: deleting twice is a double-tap or a retried request, not an error,
 * and the second call must not reverse anything a second time.
 */
export const deleteExpense = (args: { expenseId: string; groupId: string }) =>
  db.transaction(async (tx) => {
    await lockGroup(tx, args.groupId);

    const expense = await lockExpense(tx, {
      expenseId: args.expenseId,
      groupId: args.groupId,
    });

    if (!expense) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Expense not found" });
    }

    if (expense.deletedAt) return { expenseId: args.expenseId };

    await reverseExpenseVersion(tx, {
      expenseId: args.expenseId,
      groupId: args.groupId,
      version: expense.currentVersion,
    });

    await tx
      .update(Expenses)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(Expenses.id, args.expenseId),
          eq(Expenses.groupId, args.groupId),
        ),
      );

    await assertGroupIntegrity(tx, args.groupId);

    return { expenseId: args.expenseId };
  });
