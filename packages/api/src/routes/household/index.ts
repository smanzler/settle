import { fromCents, inviteInputSchema } from "@budget/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { alias, type PgUpdateSetSource } from "drizzle-orm/pg-core";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import db from "../../db";
import {
  BankAccounts,
  HouseholdInvites,
  HouseholdMembers,
  Households,
  LedgerEntries,
  PlaidItems,
  Transactions,
  users,
} from "../../db/schema";
import { renderInviteEmail } from "../../lib/invite-email";
import {
  hasPostedEntries,
  resolveActiveMember,
  setActiveHousehold,
  toNormalizedEmail,
} from "../../lib/household";
import { lockHousehold, type Tx } from "../../lib/ledger";
import { sendEmail } from "../../lib/mailer";
import { toIso } from "../../lib/serialize";
import {
  householdProcedure,
  ownerProcedure,
  protectedProcedure,
  router,
} from "../../lib/trpc";

/** `YYYY-MM-DD` — the shape every `date` column in this schema round-trips. */
const today = () => new Date().toISOString().slice(0, 10);

const isOwner = (seat: { role: string }) => seat.role === "owner";

/** `Amex`, `Amex and Chase`, `Amex, Chase and Ally` — for a refusal sentence. */
const formatNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? "an account")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `invites.mine` names two different seats off one invite — who sent it and
 * which seat it fills — so it needs two copies of the members table.
 */
const Inviter = alias(HouseholdMembers, "inviter");
const Seat = alias(HouseholdMembers, "seat");

/**
 * Base32 minus every glyph a human misreads off a screen: no 0/O, no 1/I/L.
 * That leaves 31 symbols — one short of a power of two, which is why the code
 * below rejects out-of-range draws instead of taking a modulo, since a modulo
 * would quietly bias the head of the alphabet.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 10;

const inviteCode = () => {
  let code = "";

  while (code.length < CODE_LENGTH) {
    for (const byte of randomBytes(CODE_LENGTH)) {
      const index = byte & 31;
      if (index >= CODE_ALPHABET.length) continue;

      code += CODE_ALPHABET[index];
      if (code.length === CODE_LENGTH) break;
    }
  }

  return code;
};

/**
 * Retires a seat, cancelling what it owes if asked to.
 *
 * Shared by `removeMember` and `leave`, which differ only in who decides and in
 * who inherits — everything below is the same money problem either way, and the
 * ordering inside it is load-bearing:
 *
 * 1. Accounts before balances. An account still owned by this seat keeps
 *    stamping `creditor_member_id` onto new transactions, so on an
 *    `equal`-splitting account it raises fresh debt owed to the very seat whose
 *    balance is about to be cancelled. Refusing *after* the write-off would
 *    leave a household that has cancelled a real debt and still cannot retire
 *    the seat.
 * 2. The caller must hold `lockHousehold` already. The write-off is
 *    read-then-append against an append-only table, and a share posted between
 *    the two halves would be zeroed without ever having been counted.
 */
const retireSeat = async (
  tx: Tx,
  args: {
    householdId: string;
    /** The seat being retired. */
    target: { id: string; displayName: string };
    /** Whose name goes on the adjustment entries. */
    actorMemberId: string;
    /** `self` when somebody is leaving; changes every sentence below. */
    voice: "self" | "other";
    writeOffBalance: boolean | undefined;
  },
) => {
  const { householdId, target, voice } = args;
  const subject = voice === "self" ? "You" : target.displayName;

  const owned = await tx
    .select({ name: BankAccounts.name })
    .from(BankAccounts)
    .where(
      and(
        eq(BankAccounts.householdId, householdId),
        eq(BankAccounts.ownerMemberId, target.id),
      ),
    )
    .orderBy(BankAccounts.name);

  if (owned.length > 0) {
    const names = formatNames(owned.map((account) => account.name));
    const it = owned.length === 1 ? "it" : "them";

    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        voice === "self"
          ? `You still own ${names}. Hand ${it} to somebody else first — new transactions on an account are owed to whoever owns it.`
          : `${subject} still owns ${names}. Reassign ${it} to somebody else first — new transactions on an account are owed to whoever owns it.`,
    });
  }

  const outstanding = await tx.execute<{
    other_member_id: string;
    iso_currency_code: string;
    cents: string;
  }>(sql`
    select
      case when debtor_member_id = ${target.id}
           then creditor_member_id else debtor_member_id end
        as other_member_id,
      iso_currency_code,
      sum(case when debtor_member_id = ${target.id}
               then amount_cents else -amount_cents end)::text
        as cents
    from ledger_entries
    where household_id = ${householdId}
      and (debtor_member_id = ${target.id} or creditor_member_id = ${target.id})
    group by 1, 2
    having sum(case when debtor_member_id = ${target.id}
                    then amount_cents else -amount_cents end) <> 0
  `);

  // `sum()` arrives from node-postgres as a string, never a number.
  // Signed from the leaving seat's side: positive means they owe.
  const pairs = outstanding.rows.map((row) => ({
    otherMemberId: row.other_member_id,
    currency: row.iso_currency_code,
    cents: Number(row.cents),
  }));

  if (pairs.length > 0 && args.writeOffBalance !== true) {
    const names = new Map(
      (
        await tx
          .select({
            id: HouseholdMembers.id,
            displayName: HouseholdMembers.displayName,
          })
          .from(HouseholdMembers)
          .where(eq(HouseholdMembers.householdId, householdId))
      ).map((seat) => [seat.id, seat.displayName]),
    );

    const summary = pairs
      .map((pair) => {
        const other = names.get(pair.otherMemberId) ?? "another member";
        const amount = `${fromCents(Math.abs(pair.cents))} ${pair.currency}`;
        const owes = voice === "self" ? "still owe" : "still owes";

        return pair.cents > 0
          ? `${subject} ${owes} ${other} ${amount}`
          : `${other} still owes ${voice === "self" ? "you" : subject} ${amount}`;
      })
      .join("; ");

    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${summary}. Write the balance off to ${
        voice === "self" ? "leave" : "remove them"
      } anyway.`,
    });
  }

  if (pairs.length > 0) {
    const externalRef = `adjustment:${target.id}:${randomUUID()}`;
    const effectiveDate = today();

    await tx.insert(LedgerEntries).values(
      pairs.map((pair) => ({
        householdId,
        // Same direction as the balance it cancels, opposite sign — a ledger row
        // is never updated or deleted, so zeroing a pair means appending its
        // negation.
        debtorMemberId: pair.cents > 0 ? target.id : pair.otherMemberId,
        creditorMemberId: pair.cents > 0 ? pair.otherMemberId : target.id,
        amountCents: -Math.abs(pair.cents),
        isoCurrencyCode: pair.currency,
        kind: "adjustment" as const,
        externalRef,
        memo: `Balance written off when ${target.displayName} ${
          voice === "self" ? "left" : "was removed"
        }`,
        effectiveDate,
        createdByMemberId: args.actorMemberId,
      })),
    );
  }

  // An outstanding code for this seat would set it straight back to `active` and
  // undo the retirement.
  await tx
    .update(HouseholdInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(HouseholdInvites.householdId, householdId),
        eq(HouseholdInvites.memberId, target.id),
        isNull(HouseholdInvites.redeemedAt),
        isNull(HouseholdInvites.revokedAt),
      ),
    );

  await tx
    .update(HouseholdMembers)
    .set({ status: "removed", removedAt: new Date() })
    .where(
      and(
        eq(HouseholdMembers.id, target.id),
        eq(HouseholdMembers.householdId, householdId),
      ),
    );

  // Magnitudes, summed per currency: two pairs can point in opposite directions,
  // so a signed total would report a write-off of nothing.
  const currencies = [...new Set(pairs.map((pair) => pair.currency))];

  return {
    writtenOff:
      pairs.length === 0
        ? null
        : currencies.map((currency) => ({
            cents: pairs
              .filter((pair) => pair.currency === currency)
              .reduce((total, pair) => total + Math.abs(pair.cents), 0),
            currency,
          })),
  };
};

export const householdRouter = router({
  /**
   * Every household this user can act in, for the switcher.
   *
   * `protectedProcedure`, not `householdProcedure`: this is the query that has to
   * work *before* a household is chosen, and resolving one here would bootstrap
   * one as a side effect of merely listing.
   */
  list: protectedProcedure.query(async (opts) => {
    const { user } = opts.ctx;

    const rows = await db
      .select({
        householdId: HouseholdMembers.householdId,
        memberId: HouseholdMembers.id,
        name: Households.name,
        role: HouseholdMembers.role,
        joinedAt: HouseholdMembers.joinedAt,
      })
      .from(HouseholdMembers)
      .innerJoin(Households, eq(Households.id, HouseholdMembers.householdId))
      .where(
        and(
          eq(HouseholdMembers.userId, user.id),
          eq(HouseholdMembers.status, "active"),
        ),
      )
      .orderBy(asc(HouseholdMembers.createdAt));

    // Resolved through the same path a request uses, so the highlighted row in
    // the switcher is always the household the next query will actually answer
    // for — including when the stored preference has fallen back.
    const active = await resolveActiveMember(user.id);

    return rows.map((row) => ({
      ...row,
      joinedAt: toIso(row.joinedAt),
      isActive: row.memberId === active?.id,
    }));
  }),

  /**
   * Switches which household this user is acting in.
   *
   * Membership is proven here rather than trusted, so the stored preference can
   * never widen what the caller can reach: an id they hold no active seat in is
   * refused, and `resolveActiveMember` re-checks the seat on every request
   * afterwards anyway.
   */
  setActive: protectedProcedure
    .input(z.object({ householdId: z.uuid() }))
    .mutation(async (opts) => {
      const { user } = opts.ctx;
      const { householdId } = opts.input;

      const seat = await db.query.HouseholdMembers.findFirst({
        where: { userId: user.id, householdId, status: "active" },
        columns: { id: true },
      });

      if (!seat) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You are not a member of that household",
        });
      }

      await setActiveHousehold({ householdId, tx: db, userId: user.id });

      return { householdId, memberId: seat.id };
    }),
  get: householdProcedure.query(async (opts) => {
    const { householdId, member } = opts.ctx;

    const [household, posted] = await Promise.all([
      db.query.Households.findFirst({
        where: { id: householdId },
        columns: { id: true, name: true, defaultCurrency: true },
        with: {
          members: {
            columns: { id: true, displayName: true, status: true, role: true },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      // Rides `ledger_entries_household_ref_idx`, and it is what lets the client
      // render the currency as fixed instead of discovering it through a
      // refusal after the picker has already been opened.
      hasPostedEntries(householdId),
    ]);

    if (!household) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Household not found",
      });
    }

    return {
      id: household.id,
      name: household.name,
      defaultCurrency: household.defaultCurrency,
      /** Once anything has been posted, `setCurrency` refuses — see there. */
      currencyLocked: posted,
      myMemberId: member.id,
      // Removed seats are included: the ledger and the activity feed still
      // reference them, so the client needs a name for every id it can meet.
      members: household.members.map((seat) => ({
        id: seat.id,
        displayName: seat.displayName,
        isYou: seat.id === member.id,
        status: seat.status,
        role: seat.role,
      })),
    };
  }),

  rename: ownerProcedure
    .input(z.object({ name: z.string().trim().min(1).max(80) }))
    .mutation(async (opts) => {
      const { householdId } = opts.ctx;
      const { name } = opts.input;

      const [household] = await db
        .update(Households)
        .set({ name })
        .where(eq(Households.id, householdId))
        .returning({ id: Households.id, name: Households.name });

      if (!household) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Household not found",
        });
      }

      return household;
    }),

  /**
   * The household's currency, changeable only while it has no history.
   *
   * Load-bearing rather than cosmetic: `resolveDefaultSplit` leaves any
   * transaction whose currency differs from this one whole on the payer
   * (lib/splits.ts), so a household stuck on the wrong currency auto-splits
   * nothing and reads as a broken app rather than a misconfigured one. Nothing
   * set this after `ensureHousehold` took the column default until now.
   *
   * Frozen once a ledger entry exists, and that is the whole safety argument.
   * Entries freeze their currency at post time and `pairBalances` groups by it,
   * so a later change cannot rewrite them — it would strand the old balance in a
   * currency `settlements.create`, which always mints in the *current* default,
   * could never pay off. Refusing is the only honest answer; converting would
   * need an FX rate this app does not have.
   */
  setCurrency: ownerProcedure
    .input(
      z.object({
        /**
         * ISO 4217. Uppercased here rather than trusted, because the column
         * feeds equality tests against Plaid's `iso_currency_code`, which is
         * always upper case — a lowercase 'usd' would silently match nothing
         * and disable auto-splitting exactly as a wrong code would.
         */
        currency: z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, like USD"),
      }),
    )
    .mutation(async (opts) => {
      const { householdId } = opts.ctx;
      const { currency } = opts.input;

      if (await hasPostedEntries(householdId)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This household already has balances, so its currency is fixed. Settle up and remove the shared accounts first, or start a new household.",
        });
      }

      const [household] = await db
        .update(Households)
        .set({ defaultCurrency: currency })
        .where(eq(Households.id, householdId))
        .returning({
          id: Households.id,
          defaultCurrency: Households.defaultCurrency,
        });

      if (!household) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Household not found",
        });
      }

      return household;
    }),

  invite: ownerProcedure.input(inviteInputSchema).mutation(async (opts) => {
    const { householdId, member } = opts.ctx;
    const { displayName } = opts.input;

    const email = toNormalizedEmail(opts.input.email);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invited = await db.transaction(async (tx) => {
      // `household_invites_open_email_key` makes a second open invite for the
      // same address a constraint violation rather than a no-op, so reusing
      // the live row has to be read-then-write. The lock is what keeps a
      // double-tap from 500ing in between the two halves.
      await lockHousehold(tx, householdId);

      // The partial unique index only covers *open* invites, so once one has
      // been redeemed nothing stops a second invite for the same address —
      // which would mint a seat `acceptInvite` then refuses to fill, leaving
      // a permanent phantom "Invited" row in the members list.
      const [claimed] = await tx
        .select({ id: HouseholdMembers.id })
        .from(HouseholdMembers)
        .innerJoin(users, eq(users.id, HouseholdMembers.userId))
        .where(
          and(
            eq(HouseholdMembers.householdId, householdId),
            eq(HouseholdMembers.status, "active"),
            sql`lower(${users.email}) = ${email}`,
          ),
        )
        .limit(1);

      if (claimed) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "They are already in this household",
        });
      }

      const [open] = await tx
        .select({
          id: HouseholdInvites.id,
          memberId: HouseholdInvites.memberId,
          code: HouseholdInvites.code,
        })
        .from(HouseholdInvites)
        .where(
          and(
            eq(HouseholdInvites.householdId, householdId),
            eq(HouseholdInvites.email, email),
            isNull(HouseholdInvites.redeemedAt),
            isNull(HouseholdInvites.revokedAt),
          ),
        )
        .limit(1);

      if (open) {
        // Re-inviting extends the live invite rather than minting a second
        // seat — the first one may already be carrying splits.
        await tx
          .update(HouseholdInvites)
          .set({ expiresAt })
          .where(
            and(
              eq(HouseholdInvites.id, open.id),
              eq(HouseholdInvites.householdId, householdId),
            ),
          );

        // Fixing a typo in the name is the other reason to re-invite. Guarded
        // on `invited` so this path can never rename a claimed seat.
        await tx
          .update(HouseholdMembers)
          .set({ displayName })
          .where(
            and(
              eq(HouseholdMembers.id, open.memberId),
              eq(HouseholdMembers.householdId, householdId),
              eq(HouseholdMembers.status, "invited"),
            ),
          );

        return {
          inviteId: open.id,
          memberId: open.memberId,
          code: open.code,
          expiresAt: expiresAt.toISOString(),
        };
      }

      // The seat is created up front and exists whether or not the invite is
      // ever accepted: splitting tonight's dinner with a roommate cannot wait
      // on them installing the app.
      const [seat] = await tx
        .insert(HouseholdMembers)
        .values({
          householdId,
          displayName,
          role: "member",
          status: "invited",
        })
        .returning({ id: HouseholdMembers.id });

      if (!seat) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create the member seat",
        });
      }

      const [invite] = await tx
        .insert(HouseholdInvites)
        .values({
          householdId,
          memberId: seat.id,
          email,
          code: inviteCode(),
          invitedByMemberId: member.id,
          expiresAt,
        })
        .returning({
          id: HouseholdInvites.id,
          code: HouseholdInvites.code,
          expiresAt: HouseholdInvites.expiresAt,
        });

      if (!invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create the invite",
        });
      }

      return {
        inviteId: invite.id,
        memberId: seat.id,
        code: invite.code,
        expiresAt: invite.expiresAt.toISOString(),
      };
    });

    // After the commit, and never fatal. The invite is on file and the client
    // still has the share sheet and `invites.mine` as delivery paths, so a dead
    // SMTP host must not turn a successful invite into an error the owner will
    // answer by inviting again — which extends the same row and re-sends the
    // same code, but only after they have been told it failed.
    try {
      const household = await db.query.Households.findFirst({
        where: { id: householdId },
        columns: { name: true },
      });

      const { subject, html, text } = renderInviteEmail({
        householdName: household?.name ?? "a household",
        invitedByName: member.displayName,
        code: invited.code,
        expiresInDays: Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000)),
      });

      await sendEmail({ to: email, subject, html, text });
    } catch (caught) {
      console.error("failed to email an invite", caught);
    }

    return invited;
  }),

  invites: router({
    list: householdProcedure.query(async (opts) => {
      const rows = await db
        .select({
          id: HouseholdInvites.id,
          displayName: HouseholdMembers.displayName,
          email: HouseholdInvites.email,
          code: HouseholdInvites.code,
          expiresAt: HouseholdInvites.expiresAt,
          revokedAt: HouseholdInvites.revokedAt,
        })
        .from(HouseholdInvites)
        .innerJoin(
          HouseholdMembers,
          eq(HouseholdMembers.id, HouseholdInvites.memberId),
        )
        .where(
          and(
            eq(HouseholdInvites.householdId, opts.ctx.householdId),
            isNull(HouseholdInvites.redeemedAt),
            isNull(HouseholdInvites.revokedAt),
          ),
        )
        .orderBy(asc(HouseholdInvites.createdAt));

      // Expired invites stay in the list so the client can offer to re-send one
      // instead of silently losing it.
      return rows.map((row) => ({
        ...row,
        expiresAt: row.expiresAt.toISOString(),
        revokedAt: toIso(row.revokedAt),
      }));
    }),

    revoke: ownerProcedure
      .input(z.object({ inviteId: z.uuid() }))
      .mutation(async (opts) => {
        const { householdId } = opts.ctx;
        const { inviteId } = opts.input;

        const [revoked] = await db
          .update(HouseholdInvites)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(HouseholdInvites.id, inviteId),
              eq(HouseholdInvites.householdId, householdId),
              isNull(HouseholdInvites.redeemedAt),
              isNull(HouseholdInvites.revokedAt),
            ),
          )
          .returning({ id: HouseholdInvites.id });

        if (!revoked) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Invite not found",
          });
        }

        // The seat deliberately survives: you can still split with someone whose
        // invite you took back, and `removeMember` is the way to retire them.
        return { inviteId: revoked.id };
      }),

    /**
     * The invites waiting for *you*.
     *
     * A `protectedProcedure` and never a `householdProcedure`, for the reason
     * spelled out on `acceptInvite`: resolving a household bootstraps one, and
     * asking "who has invited me?" must not have creating a household as a side
     * effect.
     *
     * This does not weaken the code. Authorization for accepting is already the
     * verified-email match — the code is only a capability that travels — and
     * this query is scoped by that same predicate, so it discloses nothing to a
     * caller who could not already accept. It is strictly better in two ways:
     * the code stops travelling through screenshots and group chats (which today
     * also leaks the invitee's address, see the share sheet on the client), and
     * "I pasted the code into the wrong account" stops being reachable.
     *
     * Verified sessions only, matching accept. Listing to an unverified one
     * would disclose "somebody invited this address" to a caller who has never
     * demonstrated they own it.
     */
    mine: protectedProcedure.query(async (opts) => {
      const { user } = opts.ctx;

      if (!user.emailVerified) return [];

      const rows = await db
        .select({
          id: HouseholdInvites.id,
          expiresAt: HouseholdInvites.expiresAt,
          householdName: Households.name,
          invitedByName: Inviter.displayName,
          /** The seat's name, which the inviter chose — "Sam", not your email. */
          seatName: Seat.displayName,
        })
        .from(HouseholdInvites)
        .innerJoin(Households, eq(Households.id, HouseholdInvites.householdId))
        .innerJoin(Inviter, eq(Inviter.id, HouseholdInvites.invitedByMemberId))
        .innerJoin(Seat, eq(Seat.id, HouseholdInvites.memberId))
        .where(
          and(
            sql`lower(${HouseholdInvites.email}) = ${toNormalizedEmail(user.email)}`,
            isNull(HouseholdInvites.redeemedAt),
            isNull(HouseholdInvites.revokedAt),
            // Unlike `list`, which keeps expired rows so an owner can re-send:
            // an expired invite here is a button that cannot work.
            gt(HouseholdInvites.expiresAt, sql`now()`),
          ),
        )
        .orderBy(asc(HouseholdInvites.createdAt));

      return rows.map((row) => ({
        ...row,
        expiresAt: row.expiresAt.toISOString(),
      }));
    }),
  }),

  /**
   * Deliberately NOT a `householdProcedure`. Resolving a household here would
   * bootstrap one for the caller on the way in, and they would then be joining
   * from inside a competing household they never asked for.
   */
  acceptInvite: protectedProcedure
    .input(
      z.union([
        z.object({ code: z.string() }),
        /**
         * Accepting one off `invites.mine`, where there is no code to type.
         *
         * The id is deliberately **not** a bearer token: the verified-email match
         * below runs identically for both inputs, so holding an invite id you
         * were not sent gets the same `NOT_FOUND` as holding a stranger's code.
         */
        z.object({ inviteId: z.uuid() }),
      ]),
    )
    .mutation(async (opts) => {
      const { user } = opts.ctx;

      // The code travels through a share sheet, so it cannot be the guard: a
      // forwarded screenshot must not hand a stranger every transaction in the
      // household. The real check is the address on the invite matching a
      // *verified* session, which is why an unverified one is refused outright
      // rather than being allowed to prove ownership of an address it never
      // demonstrated.
      if (!user.emailVerified) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Verify your email address before joining a household",
        });
      }

      // `code` is globally unique and `id` is the primary key, so either one
      // identifies at most one invite without needing a household to scope it.
      const invite = await db.query.HouseholdInvites.findFirst({
        where:
          "code" in opts.input
            ? { code: opts.input.code.trim().toUpperCase() }
            : { id: opts.input.inviteId },
        columns: {
          id: true,
          householdId: true,
          memberId: true,
          email: true,
          expiresAt: true,
          revokedAt: true,
          redeemedAt: true,
          redeemedByUserId: true,
        },
      });

      // Lowercased on both sides rather than trusting the write path: a row that
      // predates that rule, or one seeded by hand, would otherwise refuse its
      // own addressee forever.
      if (
        !invite ||
        toNormalizedEmail(invite.email) !== toNormalizedEmail(user.email)
      ) {
        // One error for both cases. Whoever is holding a forwarded code learns
        // nothing from being told the code was real.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That invite is not valid for this account",
        });
      }

      // A double-tap on Join, or a TanStack retry over a dropped response.
      if (invite.redeemedAt && invite.redeemedByUserId === user.id) {
        return {
          householdId: invite.householdId,
          memberId: invite.memberId,
        };
      }

      if (invite.redeemedAt || invite.revokedAt) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "This invite has already been used",
        });
      }

      if (invite.expiresAt.getTime() <= Date.now()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This invite has expired — ask for a new one",
        });
      }

      // Joining is now additive: you keep every household you are already in and
      // this one becomes the active choice.
      //
      // What used to be here was a refusal — "your current household still has
      // bank connections, transactions or other members; leave it before joining
      // another one" — followed by retiring the seat you arrived with. Both existed
      // only because resolution picked your oldest active seat and two active
      // seats were therefore ambiguous. Both were also a trap: the refusal's probe
      // counted `invited` and `removed` seats with no status filter, `revokeInvite`
      // deliberately keeps its seat, and no `leave` procedure existed — so one
      // invite sent and taken back locked a user out of ever accepting one, and
      // told them to do something the API could not do.
      const alreadyIn = await db.query.HouseholdMembers.findFirst({
        where: {
          userId: user.id,
          householdId: invite.householdId,
          status: "active",
        },
        columns: { id: true },
      });

      if (alreadyIn) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already a member of this household",
        });
      }

      return db.transaction(async (tx) => {
        // The whole of single-use lives in this one statement's WHERE. The
        // checks above exist to produce a decent error message; they do not
        // decide anything, because two devices tapping Join at once would both
        // pass them and only one can win here.
        const [redeemed] = await tx
          .update(HouseholdInvites)
          .set({ redeemedAt: new Date(), redeemedByUserId: user.id })
          .where(
            and(
              eq(HouseholdInvites.id, invite.id),
              isNull(HouseholdInvites.redeemedAt),
              isNull(HouseholdInvites.revokedAt),
              gt(HouseholdInvites.expiresAt, sql`now()`),
            ),
          )
          .returning({
            householdId: HouseholdInvites.householdId,
            memberId: HouseholdInvites.memberId,
          });

        if (!redeemed) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This invite is no longer valid",
          });
        }

        const [seat] = await tx
          .update(HouseholdMembers)
          .set({ userId: user.id, status: "active", joinedAt: new Date() })
          .where(
            and(
              eq(HouseholdMembers.id, redeemed.memberId),
              eq(HouseholdMembers.householdId, redeemed.householdId),
              // Fills the seat the invite already created — never a second one,
              // or every split made against the first would point at a stranger.
              // `invited` also refuses a seat retired while the code was in
              // flight, which would otherwise resurrect a removed member.
              eq(HouseholdMembers.status, "invited"),
            ),
          )
          .returning({ id: HouseholdMembers.id });

        if (!seat) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That seat is no longer available",
          });
        }

        // Land them in the household they just joined rather than wherever they
        // happened to be. This is the whole reason the old seat no longer has to
        // be retired: the preference disambiguates two active seats, so nothing
        // has to be destroyed to make resolution deterministic.
        await setActiveHousehold({
          householdId: redeemed.householdId,
          tx,
          userId: user.id,
        });

        return { householdId: redeemed.householdId, memberId: seat.id };
      });
    }),

  removeMember: ownerProcedure
    .input(
      z.object({
        memberId: z.uuid(),
        writeOffBalance: z.boolean().optional(),
      }),
    )
    .mutation(async (opts) => {
      const { householdId, member } = opts.ctx;
      const { memberId, writeOffBalance } = opts.input;

      if (memberId === member.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself",
        });
      }

      return db.transaction(async (tx) => {
        // Before the balances are read, not after: the write-off is
        // read-then-append against an append-only table, and a share posted
        // between the two would be zeroed out without ever being counted.
        await lockHousehold(tx, householdId);

        const [target] = await tx
          .select({
            id: HouseholdMembers.id,
            displayName: HouseholdMembers.displayName,
            role: HouseholdMembers.role,
            status: HouseholdMembers.status,
          })
          .from(HouseholdMembers)
          .where(
            and(
              eq(HouseholdMembers.id, memberId),
              eq(HouseholdMembers.householdId, householdId),
            ),
          )
          .limit(1);

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member not found",
          });
        }

        if (target.status === "removed") {
          return { memberId, writtenOff: null };
        }

        if (target.role === "owner") {
          const remainingOwners = await tx
            .select({ id: HouseholdMembers.id })
            .from(HouseholdMembers)
            .where(
              and(
                eq(HouseholdMembers.householdId, householdId),
                eq(HouseholdMembers.role, "owner"),
                eq(HouseholdMembers.status, "active"),
                ne(HouseholdMembers.id, memberId),
              ),
            )
            .limit(1);

          if (remainingOwners.length === 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "A household must keep at least one owner",
            });
          }
        }

        // The accounts are all reassigned by the time this runs — `retireSeat`
        // refuses otherwise — but the *item* still seeds `owner_member_id` onto
        // any account Plaid discovers later, which would hand a removed seat a
        // new account nobody asked it to own. That cannot raise debt on its own
        // (a new account defaults to owner-only, which posts no entries), and
        // there is no UI for item ownership, so it is moved rather than refused:
        // an account seeded to the acting owner is at least visible and
        // reassignable in the account sheet.
        await tx
          .update(PlaidItems)
          .set({ ownerMemberId: member.id })
          .where(
            and(
              eq(PlaidItems.householdId, householdId),
              eq(PlaidItems.ownerMemberId, memberId),
            ),
          );

        const { writtenOff } = await retireSeat(tx, {
          householdId,
          target,
          actorMemberId: member.id,
          voice: "other",
          writeOffBalance,
        });

        return { memberId, writtenOff };
      });
    }),

  /**
   * Hands the household to somebody else.
   *
   * Necessary the moment `leave` exists: `invite` hardcodes `role: 'member'` and
   * nothing else ever writes `role`, so before this every household had exactly
   * one owner — its creator — forever. Without a way to pass that on, an owner
   * who wanted out was stuck, and the switcher would show them a household they
   * could never shed.
   *
   * Demotes the caller in the same statement pair, so the household never
   * momentarily has two owners or none.
   */
  transferOwnership: ownerProcedure
    .input(z.object({ toMemberId: z.uuid() }))
    .mutation(async (opts) => {
      const { householdId, member } = opts.ctx;
      const { toMemberId } = opts.input;

      if (toMemberId === member.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already own this household",
        });
      }

      return db.transaction(async (tx) => {
        const [target] = await tx
          .select({
            id: HouseholdMembers.id,
            displayName: HouseholdMembers.displayName,
            userId: HouseholdMembers.userId,
            status: HouseholdMembers.status,
          })
          .from(HouseholdMembers)
          .where(
            and(
              eq(HouseholdMembers.id, toMemberId),
              eq(HouseholdMembers.householdId, householdId),
            ),
          )
          .limit(1);

        if (!target || target.status !== "active") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That person is not an active member of this household",
          });
        }

        // An unclaimed seat has no user behind it, so handing it the household
        // would leave nobody able to exercise the role — every owner-gated
        // procedure resolves its member from a session.
        if (!target.userId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${target.displayName} hasn't accepted their invite yet, so they can't own the household.`,
          });
        }

        await tx
          .update(HouseholdMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(HouseholdMembers.id, toMemberId),
              eq(HouseholdMembers.householdId, householdId),
            ),
          );

        await tx
          .update(HouseholdMembers)
          .set({ role: "member" })
          .where(
            and(
              eq(HouseholdMembers.id, member.id),
              eq(HouseholdMembers.householdId, householdId),
            ),
          );

        return { ownerMemberId: toMemberId };
      });
    }),

  /**
   * Leaves the household you are currently in.
   *
   * The exit that did not exist. Until multi-household landed, the only ways out
   * were being removed by an owner or accepting an invite while your household
   * was provably empty — and `acceptInvite`'s own refusal told users to "leave it
   * before joining another one", which no procedure implemented.
   *
   * Retiring rather than deleting, like every other seat retirement: the ledger
   * references this seat forever, so its history has to keep rendering with a
   * name.
   */
  leave: householdProcedure
    .input(z.object({ writeOffBalance: z.boolean().optional() }).optional())
    .mutation(async (opts) => {
      const { householdId, member, user } = opts.ctx;
      const writeOffBalance = opts.input?.writeOffBalance;

      return db.transaction(async (tx) => {
        // Before the balances are read: see `retireSeat`.
        await lockHousehold(tx, householdId);

        const others = await tx
          .select({
            id: HouseholdMembers.id,
            role: HouseholdMembers.role,
          })
          .from(HouseholdMembers)
          .where(
            and(
              eq(HouseholdMembers.householdId, householdId),
              eq(HouseholdMembers.status, "active"),
              ne(HouseholdMembers.id, member.id),
            ),
          );

        // Leaving as the last owner of a household other people are still in
        // would leave it unadministrable — nobody could invite, remove, rename or
        // reassign an account ever again. Leaving as the last member *anywhere* is
        // fine: the household simply goes quiet, and its data stays for whoever
        // still has a balance riding on it.
        const remainingOwner = others.find(isOwner);

        if (member.role === "owner" && others.length > 0 && !remainingOwner) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "You're the only owner. Make somebody else the owner before you leave.",
          });
        }

        // Items seed `owner_member_id` onto accounts Plaid discovers later, so
        // they must not stay pointed at a retired seat. A remaining owner
        // inherits; with nobody left there is nothing to hand them to, and the
        // household has no live member to surprise.
        const inheritor = remainingOwner ?? others[0];

        if (inheritor) {
          await tx
            .update(PlaidItems)
            .set({ ownerMemberId: inheritor.id })
            .where(
              and(
                eq(PlaidItems.householdId, householdId),
                eq(PlaidItems.ownerMemberId, member.id),
              ),
            );
        }

        const { writtenOff } = await retireSeat(tx, {
          householdId,
          target: { id: member.id, displayName: member.displayName },
          actorMemberId: member.id,
          voice: "self",
          writeOffBalance,
        });

        // Point them somewhere they can still act. Null rather than a guess:
        // `resolveActiveMember` falls back to their oldest remaining seat, and
        // bootstraps a fresh household only if they now hold none at all.
        await setActiveHousehold({ householdId: null, tx, userId: user.id });

        return { householdId, writtenOff };
      });
    }),

  setAccountOwner: ownerProcedure
    .input(z.object({ bankAccountId: z.uuid(), memberId: z.uuid() }))
    .mutation(async (opts) => {
      const { householdId } = opts.ctx;
      const { bankAccountId, memberId } = opts.input;

      // `bank_accounts_owner_fk` is composite, so the database already refuses
      // an owner from another household. This lookup is here for the error
      // message, and to refuse a removed seat, which the FK would happily allow.
      const [owner] = await db
        .select({ id: HouseholdMembers.id })
        .from(HouseholdMembers)
        .where(
          and(
            eq(HouseholdMembers.id, memberId),
            eq(HouseholdMembers.householdId, householdId),
            isNull(HouseholdMembers.removedAt),
          ),
        )
        .limit(1);

      if (!owner) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found" });
      }

      // ── PROSPECTIVE ONLY ──────────────────────────────────────────────────
      // This changes who the *next* transaction on this account is owed to and
      // nothing else. Existing transactions keep the `creditor_member_id`
      // frozen onto them at insert and NOT ONE ledger entry moves.
      //
      // The instinct is to re-post history so the balances "look right". Don't:
      // correcting a mislabelled account would then silently reassign months of
      // real, already-settled debt to somebody who never paid for any of it, and
      // there is no undo for a balance nobody can reproduce.
      const [updated] = await db
        .update(BankAccounts)
        .set({ ownerMemberId: memberId })
        .where(
          and(
            eq(BankAccounts.id, bankAccountId),
            eq(BankAccounts.householdId, householdId),
          ),
        )
        .returning({
          id: BankAccounts.id,
          ownerMemberId: BankAccounts.ownerMemberId,
        });

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      return {
        bankAccountId: updated.id,
        ownerMemberId: updated.ownerMemberId,
      };
    }),

  accounts: router({
    update: householdProcedure
      .input(
        z.object({
          bankAccountId: z.uuid(),
          isPrivate: z.boolean().optional(),
          defaultSplit: z.enum(["owner", "equal"]).optional(),
          defaultSplitFrom: z.iso.date().nullable().optional(),
          excluded: z.boolean().optional(),
        }),
      )
      .mutation(async (opts) => {
        const { householdId, member } = opts.ctx;
        const { bankAccountId, isPrivate, defaultSplit, excluded } = opts.input;
        const { defaultSplitFrom } = opts.input;

        const set: PgUpdateSetSource<typeof BankAccounts> = {};

        if (isPrivate !== undefined) set.isPrivate = isPrivate;
        if (excluded !== undefined)
          set.excludedAt = excluded ? new Date() : null;
        if (defaultSplitFrom !== undefined)
          set.defaultSplitFrom = defaultSplitFrom;

        if (defaultSplit !== undefined) {
          set.defaultSplit = defaultSplit;

          if (defaultSplit === "equal") {
            // Today, never null. `resolveDefaultSplit` reads a null
            // `defaultSplitFrom` as "applies to every transaction ever", so
            // flipping the joint Amex to "split equally" without a floor would
            // invent two years of retroactive debt on the very next sync.
            set.defaultSplitFrom = defaultSplitFrom ?? today();
          }
        } else if (defaultSplitFrom === null) {
          // The same trap from the other side. Clearing the floor on an account
          // that is *already* `equal` invents exactly the same retroactive debt,
          // and this call carries no `defaultSplit` to test. Decided inside the
          // statement so it reads the account's real split without a second
          // round trip that could be stale by the time the write lands.
          set.defaultSplitFrom = sql`case when ${BankAccounts.defaultSplit} = 'equal' then ${today()}::date else null end`;
        }

        if (Object.keys(set).length === 0) return { bankAccountId };

        // Every other field here is household configuration, but privacy is a
        // disclosure: turning somebody else's private account back to visible
        // publishes every transaction on it. ANDed into the UPDATE's own WHERE
        // rather than checked by a prior SELECT, so the permission and the write
        // are one statement.
        const privacyScope =
          isPrivate === undefined || member.role === "owner"
            ? undefined
            : eq(BankAccounts.ownerMemberId, member.id);

        return db.transaction(async (tx) => {
          const [updated] = await tx
            .update(BankAccounts)
            .set(set)
            .where(
              and(
                eq(BankAccounts.id, bankAccountId),
                eq(BankAccounts.householdId, householdId),
                privacyScope,
              ),
            )
            .returning({ id: BankAccounts.id });

          if (!updated) {
            throw new TRPCError({
              code: privacyScope ? "FORBIDDEN" : "NOT_FOUND",
              message: privacyScope
                ? "Only the account's owner can change who sees it"
                : "Account not found",
            });
          }

          // `transactions.is_private` is a copy, kept so the list's privacy
          // filter needs no join — and a copy only the sync path refreshes, and
          // only for rows whose money moved. Without this, marking an account
          // private would leave every transaction already in it visible to the
          // whole household forever.
          if (isPrivate !== undefined) {
            await tx
              .update(Transactions)
              .set({ isPrivate })
              .where(
                and(
                  eq(Transactions.bankAccountId, bankAccountId),
                  eq(Transactions.householdId, householdId),
                ),
              );
          }

          return { bankAccountId: updated.id };
        });
      }),
  }),
});
