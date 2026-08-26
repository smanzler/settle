import {
  settlementInputSchema,
  type NotificationPayload,
} from "@budget/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import db from "../../db";
import { GroupMembers, Settlements } from "../../db/schema";
import { decodeCursor, paginate } from "../../lib/keyset";
import {
  assertGroupIntegrity,
  lockGroup,
  postSettlement,
  reverseSettlement,
} from "../../lib/ledger";
import { notify } from "../../lib/notify";
import { toIso } from "../../lib/serialize";
import { groupProcedure, router } from "../../lib/trpc";

/** Both parties come out of the same table, so the list needs two of it. */
const Payer = alias(GroupMembers, "payer");
const Payee = alias(GroupMembers, "payee");

/**
 * The latest date a payment may claim, as `YYYY-MM-DD`.
 *
 * Computed per call rather than at module load: the process outlives a day, and
 * a bound frozen at boot starts refusing today's payments tomorrow.
 */
const tomorrow = () =>
  new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const settlementsRouter = router({
  /**
   * Records "I paid you back". Nothing here moves real money — it is a claim
   * about money that already moved outside the app.
   */
  create: groupProcedure
    .input(
      settlementInputSchema.extend({
        /**
         * **Client-generated.** "Settle up" prefills the full outstanding
         * amount, so a double-tap on a slow network — or a TanStack retry of a
         * request that actually succeeded — is the single most likely way to
         * invent a repayment that never happened. The id makes the write
         * idempotent instead of trusting the client not to send it twice.
         */
        settlementId: z.uuid(),
        /**
         * Bounded, because it is free text on the client and it orders the
         * payments list's keyset. A payment dated 2099 pins itself to the top
         * forever, which one fat finger should not be able to do. A day of slack
         * absorbs a device clock in a timezone ahead of the server's.
         */
        settledOn: z.iso.date().refine((value) => value <= tomorrow(), {
          message: "A payment can't be dated in the future",
        }),
      }),
    )
    .mutation(async (opts) => {
      const { groupId, member } = opts.ctx;
      const { amountCents, method, note, settledOn, settlementId, toMemberId } =
        opts.input;

      // You can only record a payment *you* made. Recording one on someone
      // else's behalf would let a member wipe out their own debt by asserting
      // the other side paid them.
      if (toMemberId === member.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot settle up with yourself",
        });
      }

      // Scoped by groupId in the filter itself, so a uuid from another group
      // reads as "not found" rather than as a member. The composite
      // `settlements_to_fk` would refuse the insert anyway, but a foreign-key
      // violation surfaces as a 500.
      //
      // `removed` seats are deliberately still payable: the seat keeps its
      // ledger history forever, so a debt to somebody who left outlives their
      // membership and has to remain settleable.
      const [payee, group] = await Promise.all([
        db.query.GroupMembers.findFirst({
          where: { id: toMemberId, groupId },
          // `userId` for the notification below. Nullable: an invited seat
          // nobody has claimed is still payable, and there is simply nobody to
          // tell in that case.
          columns: { id: true, userId: true },
        }),
        db.query.Groups.findFirst({
          where: { id: groupId },
          columns: { isoCurrencyCode: true },
        }),
      ]);

      if (!payee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      const result = await db.transaction(async (tx) => {
        await lockGroup(tx, groupId);

        const [created] = await tx
          .insert(Settlements)
          .values({
            amountCents,
            createdByMemberId: member.id,
            // Never from input: you can only ever be the payer.
            fromMemberId: member.id,
            groupId,
            id: settlementId,
            method: method ?? null,
            note: note ?? null,
            settledOn,
            toMemberId,
          })
          // The primary key is the idempotency key. A replay of the same id —
          // even one carrying a different amount — is a no-op, not a second
          // repayment and not an error the client has to interpret.
          .onConflictDoNothing()
          .returning({ id: Settlements.id });

        // Nothing inserted means the row was already here, and its ledger
        // entries went in under the same transaction as the row. Posting again
        // would double the payoff.
        //
        // But the conflict fires on the primary key alone, which is global: an
        // id belonging to *another* group lands here too, and answering
        // `created: false` there would tell the client its repayment is on file
        // when nothing was written in this group at all. The read is safe under
        // READ COMMITTED because `lockGroup` has already serialized every writer
        // of this group, so a colliding row of ours is committed and visible.
        if (!created) {
          const existing = await tx.query.Settlements.findFirst({
            where: { id: settlementId, groupId },
            columns: { id: true },
          });

          if (!existing) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "That settlement id is already in use",
            });
          }

          return { created: false, settlementId };
        }

        // Two rows summing to zero. There is no "settled" flag to set, no shares
        // to mark paid and no period to close — which also means a payoff never
        // has to agree with a balance: settling $40 against $30 of debt simply
        // leaves the pair $10 the other way.
        await postSettlement(tx, {
          amountCents,
          fromMemberId: member.id,
          groupId,
          settlementId,
          toMemberId,
        });

        await assertGroupIntegrity(tx, groupId);

        return { created: true, settlementId };
      });

      // After the commit, and only for a write that actually happened. A replay
      // returns `created: false` and must not notify again — the dedupe key
      // would cover it, but a second push for a payment already announced is
      // worth not depending on that.
      if (result.created) {
        await tell({
          dedupeKey: `settlement_recorded:${settlementId}`,
          payload: {
            type: "settlement_recorded",
            data: {
              amountCents,
              fromDisplayName: member.displayName,
              groupId,
              isoCurrencyCode: group.isoCurrencyCode,
              settlementId,
            },
          },
          userId: payee.userId,
        });
      }

      return result;
    }),

  list: groupProcedure
    // Deliberately a plain object, not `z.strictObject`: the tanstack-react-query
    // integration injects `direction` into the input on every infinite fetch,
    // and a strict schema would reject it.
    .input(
      z.object({
        cursor: z.string().optional(),
        limit: z.int().min(1).max(100).default(50),
        memberId: z.uuid().optional(),
      }),
    )
    .query(async (opts) => {
      const { groupId, member } = opts.ctx;
      const { cursor, limit, memberId } = opts.input;

      const keyset = decodeCursor(cursor);

      const rows = await db
        .select({
          amountCents: Settlements.amountCents,
          createdAt: Settlements.createdAt,
          fromDisplayName: Payer.displayName,
          fromMemberId: Settlements.fromMemberId,
          id: Settlements.id,
          method: Settlements.method,
          note: Settlements.note,
          settledOn: Settlements.settledOn,
          toDisplayName: Payee.displayName,
          toMemberId: Settlements.toMemberId,
          voidedAt: Settlements.voidedAt,
        })
        .from(Settlements)
        .innerJoin(Payer, eq(Payer.id, Settlements.fromMemberId))
        .innerJoin(Payee, eq(Payee.id, Settlements.toMemberId))
        .where(
          and(
            eq(Settlements.groupId, groupId),
            // ANDed with the group predicate, never replacing it, so a memberId
            // from another group matches nothing instead of widening the scope.
            memberId
              ? or(
                  eq(Settlements.fromMemberId, memberId),
                  eq(Settlements.toMemberId, memberId),
                )
              : undefined,
            keyset
              ? // Row-wise comparison, so the page boundary is one predicate on
                // the (group_id, settled_on desc) index rather than an OR the
                // planner has to take apart.
                sql`(${Settlements.settledOn}, ${Settlements.id}) < (${keyset.date}::date, ${keyset.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(Settlements.settledOn), desc(Settlements.id))
        .limit(limit + 1);

      const page = paginate(rows, limit, (row) => ({
        date: row.settledOn,
        id: row.id,
      }));

      return {
        items: page.items.map((row) => {
          const youPaid = row.fromMemberId === member.id;

          // Both names travel, because the caller is on neither side of a
          // settlement between two other members and "the other party" is
          // meaningless there — `youPaid: false` alone would render that row as
          // "someone paid you".
          return {
            ...row,
            createdAt: toIso(row.createdAt),
            voidedAt: toIso(row.voidedAt),
            youAreParty: youPaid || row.toMemberId === member.id,
            youPaid,
          };
        }),
        nextCursor: page.nextCursor,
      };
    }),

  /**
   * Takes a repayment back. Soft on the settlement, appended on the ledger: a
   * settlement is a claim about real money, so the other party has to be able to
   * see that it was made and then withdrawn, not find it silently absent.
   */
  void: groupProcedure
    .input(z.object({ settlementId: z.uuid() }))
    .mutation(async (opts) => {
      const { groupId, member } = opts.ctx;
      const { settlementId } = opts.input;

      const result = await db.transaction(async (tx) => {
        await lockGroup(tx, groupId);

        const [voided] = await tx
          .update(Settlements)
          .set({ voidedAt: new Date() })
          .where(
            and(
              eq(Settlements.id, settlementId),
              // Tenancy, authorship and the not-already-voided check all live in
              // the statement that does the write, so there is no window between
              // deciding and writing. Two taps race here and exactly one updates
              // a row; the loser reads back `voidedAt` and gets a CONFLICT.
              eq(Settlements.groupId, groupId),
              isNull(Settlements.voidedAt),
              member.role === "owner"
                ? undefined
                : eq(Settlements.createdByMemberId, member.id),
            ),
          )
          .returning({
            amountCents: Settlements.amountCents,
            fromMemberId: Settlements.fromMemberId,
            toMemberId: Settlements.toMemberId,
          });

        if (!voided) {
          // Zero rows is three different situations. Re-read — still scoped by
          // group — only to tell the user which one.
          const existing = await tx.query.Settlements.findFirst({
            where: { id: settlementId, groupId },
            columns: { voidedAt: true },
          });

          if (!existing) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Settlement not found",
            });
          }

          if (existing.voidedAt) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "This settlement was already voided",
            });
          }

          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Only the member who recorded this payment, or a group owner, can void it",
          });
        }

        // Negates whatever was actually posted, rather than rebuilding it from
        // the settlement row. Returning zero entries would mean the soft void
        // left money on the ledger, so the count is checked: throwing rolls the
        // void back, which is the only safe failure.
        const reversed = await reverseSettlement(tx, { groupId, settlementId });

        if (reversed === 0) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Settlement has no ledger entries to reverse",
          });
        }

        await assertGroupIntegrity(tx, groupId);

        return voided;
      });

      const group = await db.query.Groups.findFirst({
        where: { id: groupId },
        columns: { isoCurrencyCode: true },
      });

      // Both parties, minus whoever just did it. An owner may void a payment
      // they were not part of, in which case the payer needs telling as much as
      // the payee does — their balance moved back either way.
      const others = [result.fromMemberId, result.toMemberId].filter(
        (id) => id !== member.id,
      );

      if (others.length > 0) {
        const seats = await db.query.GroupMembers.findMany({
          where: { groupId, id: { in: others } },
          columns: { userId: true },
        });

        await Promise.all(
          seats.map((seat) =>
            tell({
              dedupeKey: `settlement_voided:${settlementId}`,
              payload: {
                type: "settlement_voided",
                data: {
                  amountCents: result.amountCents,
                  groupId,
                  isoCurrencyCode: group?.isoCurrencyCode ?? "USD",
                  settlementId,
                  voidedByDisplayName: member.displayName,
                },
              },
              userId: seat.userId,
            }),
          ),
        );
      }

      return { settlementId };
    }),
});

/**
 * Notifies one party about a settlement, if there is anybody there to notify.
 *
 * Never lets a push failure fail the mutation: the money is already committed,
 * and turning "we could not reach Expo" into a 500 would tell the payer their
 * repayment did not record when it did — after which they record it again. The
 * same reasoning as the signup hook's `ensureGroup` catch in lib/auth.ts.
 */
const tell = async (args: {
  /** Null for an invited seat nobody has claimed — nothing to do. */
  userId: string | null;
  payload: NotificationPayload;
  dedupeKey: string;
}) => {
  if (!args.userId) return;

  try {
    await notify({
      dedupeKey: args.dedupeKey,
      payload: args.payload,
      userId: args.userId,
    });
  } catch (caught) {
    console.error("failed to send a settlement notification", caught);
  }
};
