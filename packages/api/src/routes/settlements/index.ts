import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import db from "../../db";
import { HouseholdMembers, LedgerEntries, Settlements } from "../../db/schema";
import { decodeCursor, paginate } from "../../lib/keyset";
import { lockHousehold, settlementRef } from "../../lib/ledger";
import { notify } from "../../lib/notify";
import { toIso } from "../../lib/serialize";
import { householdProcedure, router } from "../../lib/trpc";
import type { NotificationPayload } from "@budget/shared";

/**
 * A ref of its own, deliberately not `settlement:<id>`.
 *
 * Sharing the ref would let a future "everything posted for this ref" query —
 * the shape `postShareDeltas` already uses — net the payment against its own
 * reversal and see a settlement that was never posted at all.
 */

/** Both parties come out of the same table, so the list needs two of it. */
const Payer = alias(HouseholdMembers, "payer");
const Payee = alias(HouseholdMembers, "payee");

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
  create: householdProcedure
    .input(
      z.object({
        /**
         * **Client-generated.** "Settle up" prefills the full outstanding
         * amount, so a double-tap on a slow network — or a TanStack retry of a
         * request that actually succeeded — is the single most likely way to
         * invent a repayment that never happened. The id makes the write
         * idempotent instead of trusting the client not to send it twice.
         */
        settlementId: z.uuid(),
        toMemberId: z.uuid(),
        amountCents: z.int().positive(),
        /**
         * Bounded, because it is free text on the client and it orders the
         * activity feed's keyset. A payment dated 2099 pins itself to the top of
         * every feed forever, which one fat finger — or one bored housemate —
         * should not be able to do. A day of slack absorbs a device clock in a
         * timezone ahead of the server's.
         */
        settledOn: z.iso.date().refine((value) => value <= tomorrow(), {
          message: "A payment can't be dated in the future",
        }),
        method: z.string().max(40).optional(),
        note: z.string().max(280).optional(),
      }),
    )
    .mutation(async (opts) => {
      const { householdId, member } = opts.ctx;
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

      // Scoped by householdId in the filter itself, so a uuid from another
      // household reads as "not found" rather than as a member. The composite
      // `settlements_to_fk` would refuse the insert anyway, but a foreign-key
      // violation surfaces as a 500.
      //
      // `removed` seats are deliberately still payable: the seat keeps its
      // ledger history forever, so the debt to someone who left the household
      // outlives their membership and must remain settleable.
      const [payee, household] = await Promise.all([
        db.query.HouseholdMembers.findFirst({
          where: { id: toMemberId, householdId },
          // `userId` for the notification below. Nullable: an invited seat
          // nobody has claimed is still payable, and there is simply nobody to
          // tell in that case.
          columns: { id: true, userId: true },
        }),
        db.query.Households.findFirst({
          where: { id: householdId },
          columns: { defaultCurrency: true },
        }),
      ]);

      if (!payee) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      if (!household) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Household not found",
        });
      }

      const result = await db.transaction(async (tx) => {
        await lockHousehold(tx, householdId);

        const [created] = await tx
          .insert(Settlements)
          .values({
            id: settlementId,
            householdId,
            // Never from input: you can only ever be the payer.
            fromMemberId: member.id,
            toMemberId,
            amountCents,
            isoCurrencyCode: household.defaultCurrency,
            settledOn,
            method: method ?? null,
            note: note ?? null,
            createdByMemberId: member.id,
          })
          // The primary key is the idempotency key. A replay of the same id —
          // even one carrying a different amount — is a no-op, not a second
          // repayment and not an error the client has to interpret.
          .onConflictDoNothing()
          .returning({ id: Settlements.id });

        // Nothing inserted means the row was already here, and its ledger entry
        // went in under the same transaction as the row. Posting again would
        // double the payoff.
        //
        // But the conflict fires on the primary key alone, which is global:
        // an id that belongs to *another* household lands here too, and
        // answering `created: false` there would tell the client its repayment
        // is on file when nothing was written in this household at all. The
        // read is safe under READ COMMITTED because `lockHousehold` has already
        // serialized every writer of this household, so a colliding row of ours
        // is necessarily committed and visible by now.
        if (!created) {
          const existing = await tx.query.Settlements.findFirst({
            where: { id: settlementId, householdId },
            columns: { id: true },
          });

          if (!existing) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "That settlement id is already in use",
            });
          }

          return { settlementId, created: false };
        }

        await tx.insert(LedgerEntries).values({
          householdId,
          debtorMemberId: member.id,
          creditorMemberId: toMemberId,
          // NEGATIVE: a repayment reduces what the debtor owes. This one row is
          // the entire netting mechanism — balances are `SUM(amount_cents)` per
          // pair, so there is no "settled" flag to set, no shares to mark paid
          // and no period to close. Which also means the payoff never has to
          // agree with a balance: settling $40 against $30 of debt simply
          // leaves the pair $10 the other way.
          amountCents: -amountCents,
          isoCurrencyCode: household.defaultCurrency,
          kind: "settlement",
          externalRef: settlementRef(settlementId),
          settlementId,
          memo: note ?? null,
          effectiveDate: settledOn,
          createdByMemberId: member.id,
        });

        return { settlementId, created: true };
      });

      // After the commit, and only for a write that actually happened. A replay
      // returns `created: false` and must not notify again — the dedupe key
      // would cover it, but a second push for a payment already announced is
      // worth not depending on that.
      if (result.created) {
        await tellPayee({
          userId: payee.userId,
          payload: {
            type: "settlement_recorded",
            data: {
              settlementId,
              householdId,
              fromDisplayName: member.displayName,
              amountCents,
              isoCurrencyCode: household.defaultCurrency,
            },
          },
          dedupeKey: `settlement_recorded:${settlementId}`,
        });
      }

      return result;
    }),

  list: householdProcedure
    // Deliberately a plain object, not `z.strictObject`: the tanstack-react-query
    // integration injects `direction` into the input on every infinite fetch,
    // and a strict schema would reject it.
    .input(
      z.object({
        memberId: z.uuid().optional(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.string().optional(),
      }),
    )
    .query(async (opts) => {
      const { householdId, member } = opts.ctx;
      const { memberId, limit, cursor } = opts.input;

      const keyset = decodeCursor(cursor);

      const rows = await db
        .select({
          id: Settlements.id,
          amountCents: Settlements.amountCents,
          isoCurrencyCode: Settlements.isoCurrencyCode,
          settledOn: Settlements.settledOn,
          method: Settlements.method,
          note: Settlements.note,
          voidedAt: Settlements.voidedAt,
          createdAt: Settlements.createdAt,
          fromMemberId: Settlements.fromMemberId,
          fromDisplayName: Payer.displayName,
          toMemberId: Settlements.toMemberId,
          toDisplayName: Payee.displayName,
        })
        .from(Settlements)
        .innerJoin(Payer, eq(Payer.id, Settlements.fromMemberId))
        .innerJoin(Payee, eq(Payee.id, Settlements.toMemberId))
        .where(
          and(
            eq(Settlements.householdId, householdId),
            // ANDed with the household predicate, never replacing it, so a
            // memberId from another household matches nothing instead of
            // widening the scope.
            memberId
              ? or(
                  eq(Settlements.fromMemberId, memberId),
                  eq(Settlements.toMemberId, memberId),
                )
              : undefined,
            keyset
              ? // Row-wise comparison, so the page boundary is one predicate on
                // the (household_id, settled_on desc) index rather than an OR
                // the planner has to take apart.
                sql`(${Settlements.settledOn}, ${Settlements.id}) < (${keyset.date}::date, ${keyset.id}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(Settlements.settledOn), desc(Settlements.id))
        .limit(limit + 1);

      const { items: page, nextCursor } = paginate(rows, limit, (row) => ({
        date: row.settledOn,
        id: row.id,
      }));

      const items = page.map((row) => {
        const youPaid = row.fromMemberId === member.id;

        // Both names are returned as well, because the caller is on neither
        // side of a settlement between two other members and "the other party"
        // is meaningless there — `youPaid: false` alone would render that row
        // as "someone paid you".
        const other = youPaid
          ? { memberId: row.toMemberId, displayName: row.toDisplayName }
          : { memberId: row.fromMemberId, displayName: row.fromDisplayName };

        return {
          ...row,
          youPaid,
          youAreParty: youPaid || row.toMemberId === member.id,
          otherMemberId: other.memberId,
          otherDisplayName: other.displayName,
          voidedAt: toIso(row.voidedAt),
          createdAt: toIso(row.createdAt),
        };
      });

      return { items, nextCursor };
    }),

  /**
   * Takes a repayment back. Soft on the settlement, appended on the ledger: a
   * settlement is a claim about real money, so the other party has to be able to
   * see that it was made and then withdrawn, not find it silently absent.
   */
  void: householdProcedure
    .input(z.object({ settlementId: z.uuid() }))
    .mutation(async (opts) => {
      const { householdId, member } = opts.ctx;
      const { settlementId } = opts.input;

      const result = await db.transaction(async (tx) => {
        await lockHousehold(tx, householdId);

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
              eq(Settlements.householdId, householdId),
              isNull(Settlements.voidedAt),
              member.role === "owner"
                ? undefined
                : eq(Settlements.createdByMemberId, member.id),
            ),
          )
          .returning({ id: Settlements.id });

        if (!voided) {
          // Zero rows is four different situations. Re-read — still scoped by
          // household — only to tell the user which one.
          const existing = await tx.query.Settlements.findFirst({
            where: { id: settlementId, householdId },
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
              "Only the member who recorded this payment, or a household owner, can void it",
          });
        }

        // Read the entry rather than rebuild it from the settlement row: the
        // reversal has to cancel what was actually posted, whatever that was.
        // The `:void` ref means this only ever matches the original.
        const original = await tx.query.LedgerEntries.findFirst({
          where: {
            householdId,
            externalRef: settlementRef(settlementId),
            kind: "settlement",
          },
          columns: {
            id: true,
            debtorMemberId: true,
            creditorMemberId: true,
            amountCents: true,
            isoCurrencyCode: true,
            effectiveDate: true,
          },
        });

        // Unreachable through this router — the entry and the row go in
        // together. Throwing rolls the soft void back, which is the only safe
        // failure: a voided settlement whose money is still on the ledger is a
        // balance nobody can explain.
        if (!original) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Settlement has no ledger entry to reverse",
          });
        }

        await tx.insert(LedgerEntries).values({
          householdId,
          debtorMemberId: original.debtorMemberId,
          creditorMemberId: original.creditorMemberId,
          // The exact negation, appended. The original row is never touched —
          // balances are a SUM over this table, and editing history here would
          // change a number nobody could reproduce afterwards.
          amountCents: -original.amountCents,
          isoCurrencyCode: original.isoCurrencyCode,
          kind: "settlement",
          externalRef: `${settlementRef(settlementId)}:void`,
          settlementId,
          reversesEntryId: original.id,
          memo: "Voided",
          // The original's date, not today's: the two rows then sit together in
          // the date-ordered activity feed, where a strikethrough reads as one
          // event instead of a stray credit weeks later.
          effectiveDate: original.effectiveDate,
          createdByMemberId: member.id,
        });

        return {
          settlementId,
          fromMemberId: original.debtorMemberId,
          toMemberId: original.creditorMemberId,
          // The posted entry is negative — a repayment reduces the debt — and
          // the notification states a payment amount, so it travels as a
          // magnitude.
          amountCents: Math.abs(original.amountCents),
          isoCurrencyCode: original.isoCurrencyCode,
        };
      });

      // Both parties, minus whoever just did it. An owner may void a payment
      // they were not part of, in which case the payer needs telling as much as
      // the payee does — their balance moved back up either way.
      const others = [result.fromMemberId, result.toMemberId].filter(
        (id) => id !== member.id,
      );

      if (others.length > 0) {
        const seats = await db.query.HouseholdMembers.findMany({
          where: { householdId, id: { in: others } },
          columns: { userId: true },
        });

        await Promise.all(
          seats.map((seat) =>
            tellPayee({
              userId: seat.userId,
              payload: {
                type: "settlement_voided",
                data: {
                  settlementId,
                  householdId,
                  voidedByDisplayName: member.displayName,
                  amountCents: result.amountCents,
                  isoCurrencyCode: result.isoCurrencyCode,
                },
              },
              dedupeKey: `settlement_voided:${settlementId}`,
            }),
          ),
        );
      }

      return { settlementId: result.settlementId };
    }),
});

/**
 * Notifies one party about a settlement, if there is anybody there to notify.
 *
 * Never lets a push failure fail the mutation: the money is already committed,
 * and turning "we could not reach Expo" into a 500 would tell the payer their
 * repayment did not record when it did — after which they record it again. The
 * same reasoning as the signup hook's `ensureHousehold` catch in lib/auth.ts.
 */
const tellPayee = async (args: {
  /** Null for an invited seat nobody has claimed — nothing to do. */
  userId: string | null;
  payload: NotificationPayload;
  dedupeKey: string;
}) => {
  if (!args.userId) return;

  try {
    await notify({
      userId: args.userId,
      payload: args.payload,
      dedupeKey: args.dedupeKey,
    });
  } catch (caught) {
    console.error("failed to send a settlement notification", caught);
  }
};
