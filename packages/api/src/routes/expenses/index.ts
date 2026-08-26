import { expenseInputSchema } from "@budget/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import db from "../../db";
import {
  ExpensePayers,
  Expenses,
  ExpenseShares,
  ExpenseVersions,
  GroupMembers,
} from "../../db/schema";
import {
  createExpense,
  deleteExpense,
  reviseExpense,
} from "../../lib/expenses";
import { toMemberRef, type MemberRef } from "../../lib/group";
import { decodeCursor, paginate } from "../../lib/keyset";
import { toIso } from "../../lib/serialize";
import { groupProcedure, router } from "../../lib/trpc";

const PAGE_SIZE = 30;

type Seat = { id: string; displayName: string; status: MemberRef["status"] };

/**
 * Every seat in the group, including retired ones.
 *
 * A removed member keeps their share of everything they were on, so the client
 * needs a name for every id an expense can reference — not just the ones you
 * could still add to a new one.
 */
const listSeats = async (groupId: string) => {
  const seats = await db
    .select({
      displayName: GroupMembers.displayName,
      id: GroupMembers.id,
      status: GroupMembers.status,
    })
    .from(GroupMembers)
    .where(eq(GroupMembers.groupId, groupId))
    .orderBy(asc(GroupMembers.createdAt));

  return new Map<string, Seat>(seats.map((seat) => [seat.id, seat]));
};

/** A member's slice of one version, named. */
type Slice = MemberRef & { amountCents: number };

const toSlice = (
  row: { memberId: string; amountCents: number },
  seats: Map<string, Seat>,
  youId: string,
): Slice => ({
  ...toMemberRef({
    fallbackId: row.memberId,
    member: seats.get(row.memberId),
    youId,
  }),
  amountCents: row.amountCents,
});

type SliceRow = { amountCents: number; memberId: string; versionId: string };

/** Every payer and share row across a set of versions, in one round trip each. */
const listSlices = async (
  versionIds: string[],
): Promise<{ payers: SliceRow[]; shares: SliceRow[] }> => {
  if (versionIds.length === 0) return { payers: [], shares: [] };

  const [payers, shares] = await Promise.all([
    db
      .select({
        amountCents: ExpensePayers.amountCents,
        memberId: ExpensePayers.memberId,
        versionId: ExpensePayers.expenseVersionId,
      })
      .from(ExpensePayers)
      .where(inArray(ExpensePayers.expenseVersionId, versionIds)),
    db
      .select({
        amountCents: ExpenseShares.amountCents,
        memberId: ExpenseShares.memberId,
        versionId: ExpenseShares.expenseVersionId,
      })
      .from(ExpenseShares)
      .where(inArray(ExpenseShares.expenseVersionId, versionIds)),
  ]);

  return { payers, shares };
};

const byVersion = (rows: SliceRow[], versionId: string) =>
  rows.filter((row) => row.versionId === versionId);

const sumFor = (rows: SliceRow[], memberId: string) =>
  rows
    .filter((row) => row.memberId === memberId)
    .reduce((total, row) => total + row.amountCents, 0);

export const expensesRouter = router({
  /**
   * The group's expenses, newest first, keyset-paginated.
   *
   * Ordered on the *version's* date rather than the expense's creation time, so
   * correcting a date moves the row where the user expects it to be. The cursor
   * carries both keys because several expenses share a date routinely.
   */
  list: groupProcedure
    .input(
      z
        .object({
          cursor: z.string().optional(),
          limit: z.int().min(1).max(100).default(PAGE_SIZE),
        })
        .optional(),
    )
    .query(async (opts) => {
      const { groupId, member } = opts.ctx;
      const limit = opts.input?.limit ?? PAGE_SIZE;
      const keyset = decodeCursor(opts.input?.cursor);

      const rows = await db
        .select({
          amountCents: ExpenseVersions.amountCents,
          createdAt: Expenses.createdAt,
          description: ExpenseVersions.description,
          expenseDate: ExpenseVersions.expenseDate,
          id: Expenses.id,
          version: Expenses.currentVersion,
          versionId: ExpenseVersions.id,
        })
        .from(Expenses)
        .innerJoin(
          ExpenseVersions,
          and(
            eq(ExpenseVersions.expenseId, Expenses.id),
            eq(ExpenseVersions.version, Expenses.currentVersion),
          ),
        )
        .where(
          and(
            eq(Expenses.groupId, groupId),
            isNull(Expenses.deletedAt),
            keyset
              ? sql`(${ExpenseVersions.expenseDate}, ${Expenses.id}) < (${keyset.date}::date, ${keyset.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(ExpenseVersions.expenseDate), desc(Expenses.id))
        .limit(limit + 1);

      const page = paginate(rows, limit, (row) => ({
        date: row.expenseDate,
        id: row.id,
      }));

      const [seats, slices] = await Promise.all([
        listSeats(groupId),
        listSlices(page.items.map((row) => row.versionId)),
      ]);

      return {
        items: page.items.map((row) => {
          const payers = byVersion(slices.payers, row.versionId);
          const shares = byVersion(slices.shares, row.versionId);

          return {
            amountCents: row.amountCents,
            createdAt: toIso(row.createdAt),
            description: row.description,
            expenseDate: row.expenseDate,
            id: row.id,
            participants: shares.map((share) =>
              toMemberRef({
                fallbackId: share.memberId,
                member: seats.get(share.memberId),
                youId: member.id,
              }),
            ),
            payers: payers.map((payer) => toSlice(payer, seats, member.id)),
            version: row.version,
            /** What this expense alone did to your balance. */
            yourNetCents: sumFor(payers, member.id) - sumFor(shares, member.id),
          };
        }),
        nextCursor: page.nextCursor,
      };
    }),

  get: groupProcedure
    .input(z.object({ expenseId: z.uuid() }))
    .query(async (opts) => {
      const { groupId, member } = opts.ctx;

      const [row] = await db
        .select({
          amountCents: ExpenseVersions.amountCents,
          createdAt: Expenses.createdAt,
          createdByMemberId: Expenses.createdByMemberId,
          deletedAt: Expenses.deletedAt,
          description: ExpenseVersions.description,
          expenseDate: ExpenseVersions.expenseDate,
          id: Expenses.id,
          note: ExpenseVersions.note,
          revisedAt: ExpenseVersions.createdAt,
          revisedByMemberId: ExpenseVersions.createdByMemberId,
          version: Expenses.currentVersion,
          versionId: ExpenseVersions.id,
        })
        .from(Expenses)
        .innerJoin(
          ExpenseVersions,
          and(
            eq(ExpenseVersions.expenseId, Expenses.id),
            eq(ExpenseVersions.version, Expenses.currentVersion),
          ),
        )
        .where(
          and(
            eq(Expenses.id, opts.input.expenseId),
            eq(Expenses.groupId, groupId),
          ),
        )
        .limit(1);

      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense not found",
        });
      }

      const [seats, slices] = await Promise.all([
        listSeats(groupId),
        listSlices([row.versionId]),
      ]);

      return {
        amountCents: row.amountCents,
        createdAt: toIso(row.createdAt),
        createdBy: toMemberRef({
          fallbackId: row.createdByMemberId,
          member: seats.get(row.createdByMemberId),
          youId: member.id,
        }),
        deletedAt: toIso(row.deletedAt),
        description: row.description,
        expenseDate: row.expenseDate,
        id: row.id,
        note: row.note,
        payers: slices.payers.map((payer) => toSlice(payer, seats, member.id)),
        revisedAt: toIso(row.revisedAt),
        revisedBy: toMemberRef({
          fallbackId: row.revisedByMemberId,
          member: seats.get(row.revisedByMemberId),
          youId: member.id,
        }),
        shares: slices.shares.map((share) => toSlice(share, seats, member.id)),
        version: row.version,
      };
    }),

  /**
   * Every version of an expense, oldest first — who changed what, and when.
   *
   * This is what the append-only design buys, so it is a first-class endpoint
   * rather than a debugging aid. A deleted expense still answers here.
   */
  history: groupProcedure
    .input(z.object({ expenseId: z.uuid() }))
    .query(async (opts) => {
      const { groupId, member } = opts.ctx;

      const versions = await db
        .select({
          amountCents: ExpenseVersions.amountCents,
          createdAt: ExpenseVersions.createdAt,
          createdByMemberId: ExpenseVersions.createdByMemberId,
          description: ExpenseVersions.description,
          expenseDate: ExpenseVersions.expenseDate,
          id: ExpenseVersions.id,
          note: ExpenseVersions.note,
          version: ExpenseVersions.version,
        })
        .from(ExpenseVersions)
        .where(
          and(
            eq(ExpenseVersions.expenseId, opts.input.expenseId),
            eq(ExpenseVersions.groupId, groupId),
          ),
        )
        .orderBy(asc(ExpenseVersions.version));

      if (versions.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Expense not found",
        });
      }

      const [seats, slices] = await Promise.all([
        listSeats(groupId),
        listSlices(versions.map((version) => version.id)),
      ]);

      return versions.map((version) => ({
        amountCents: version.amountCents,
        createdAt: toIso(version.createdAt),
        createdBy: toMemberRef({
          fallbackId: version.createdByMemberId,
          member: seats.get(version.createdByMemberId),
          youId: member.id,
        }),
        description: version.description,
        expenseDate: version.expenseDate,
        note: version.note,
        payers: byVersion(slices.payers, version.id).map((payer) =>
          toSlice(payer, seats, member.id),
        ),
        shares: byVersion(slices.shares, version.id).map((share) =>
          toSlice(share, seats, member.id),
        ),
        version: version.version,
      }));
    }),

  create: groupProcedure.input(expenseInputSchema).mutation((opts) =>
    createExpense({
      actorMemberId: opts.ctx.member.id,
      groupId: opts.ctx.groupId,
      input: opts.input,
    }),
  ),

  /**
   * Open to any member, not just the author. The version history makes that
   * safe: every change is attributed and nothing is destroyed, so the answer to
   * a bad edit is another edit rather than a permission.
   */
  revise: groupProcedure
    .input(z.object({ expenseId: z.uuid(), input: expenseInputSchema }))
    .mutation((opts) =>
      reviseExpense({
        actorMemberId: opts.ctx.member.id,
        expenseId: opts.input.expenseId,
        groupId: opts.ctx.groupId,
        input: opts.input.input,
      }),
    ),

  delete: groupProcedure
    .input(z.object({ expenseId: z.uuid() }))
    .mutation((opts) =>
      deleteExpense({
        expenseId: opts.input.expenseId,
        groupId: opts.ctx.groupId,
      }),
    ),
});
