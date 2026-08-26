import {
  currencySchema,
  fromCents,
  groupNameSchema,
  inviteInputSchema,
} from "@budget/shared";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import db from "../../db";
import { GroupInvites, GroupMembers, Groups, users } from "../../db/schema";
import {
  createGroup,
  memberDisplayName,
  resolveActiveMember,
  setActiveGroup,
  toNormalizedEmail,
} from "../../lib/group";
import { renderInviteEmail } from "../../lib/invite-email";
import { listGroupBalances, lockGroup, type Tx } from "../../lib/ledger";
import { sendEmail } from "../../lib/mailer";
import { toIso } from "../../lib/serialize";
import {
  groupProcedure,
  ownerProcedure,
  protectedProcedure,
  router,
} from "../../lib/trpc";

const isOwner = (seat: { role: string }) => seat.role === "owner";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `invites.mine` names two different seats off one invite — who sent it and
 * which seat it fills — so it needs two copies of the members table.
 */
const Inviter = alias(GroupMembers, "inviter");
const Seat = alias(GroupMembers, "seat");

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
 * Retires a seat that owes nothing and is owed nothing.
 *
 * Shared by `removeMember` and `leave`, which differ only in who decides and in
 * how every sentence reads. The caller must already hold `lockGroup`: this reads
 * the balances and then retires on what it read, and an expense committing in
 * between would strand a debt on a seat that has just left.
 *
 * A seat still carrying a position is refused outright. There is deliberately no
 * "write it off anyway": a balance is somebody's real money, and the way to
 * clear it is to settle up.
 */
const retireSeat = async (
  tx: Tx,
  args: {
    groupId: string;
    /** The seat being retired. */
    target: { id: string; displayName: string };
    /** `self` when somebody is leaving; changes every sentence below. */
    voice: "self" | "other";
    isoCurrencyCode: string;
  },
) => {
  const { groupId, target, voice } = args;
  const subject = voice === "self" ? "You" : target.displayName;

  const balances = await listGroupBalances(groupId, tx);
  const net =
    balances.find((balance) => balance.memberId === target.id)?.netCents ?? 0;

  if (net !== 0) {
    const amount = `${fromCents(Math.abs(net))} ${args.isoCurrencyCode}`;
    const owes = voice === "self" ? "still owe" : "still owes";

    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${
        net < 0
          ? `${subject} ${owes} the group ${amount}`
          : `The group still owes ${voice === "self" ? "you" : subject} ${amount}`
      }. Settle up first.`,
    });
  }

  // An outstanding code for this seat would set it straight back to `active` and
  // undo the retirement.
  await tx
    .update(GroupInvites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(GroupInvites.groupId, groupId),
        eq(GroupInvites.memberId, target.id),
        isNull(GroupInvites.redeemedAt),
        isNull(GroupInvites.revokedAt),
      ),
    );

  await tx
    .update(GroupMembers)
    .set({ status: "removed", removedAt: new Date() })
    .where(
      and(eq(GroupMembers.id, target.id), eq(GroupMembers.groupId, groupId)),
    );
};

export const groupsRouter = router({
  /**
   * Every group this user can act in, for the switcher.
   *
   * `protectedProcedure`, not `groupProcedure`: this is the query that has to
   * work *before* a group is chosen, and resolving one here would bootstrap one
   * as a side effect of merely listing.
   */
  list: protectedProcedure.query(async (opts) => {
    const { user } = opts.ctx;

    const rows = await db
      .select({
        groupId: GroupMembers.groupId,
        joinedAt: GroupMembers.joinedAt,
        memberId: GroupMembers.id,
        name: Groups.name,
        role: GroupMembers.role,
      })
      .from(GroupMembers)
      .innerJoin(Groups, eq(Groups.id, GroupMembers.groupId))
      .where(
        and(
          eq(GroupMembers.userId, user.id),
          eq(GroupMembers.status, "active"),
        ),
      )
      .orderBy(asc(GroupMembers.createdAt));

    // Resolved through the same path a request uses, so the highlighted row in
    // the switcher is always the group the next query will actually answer for —
    // including when the stored preference has fallen back.
    const active = await resolveActiveMember(user.id);

    return rows.map((row) => ({
      ...row,
      isActive: row.memberId === active?.id,
      joinedAt: toIso(row.joinedAt),
    }));
  }),

  /**
   * A second group — a trip, a different household — and switches into it.
   *
   * The currency is fixed here and never changes. Nothing in the app converts,
   * so re-denominating a group that already has balances would silently restate
   * everybody's position; making it immutable is the honest version of that.
   */
  create: protectedProcedure
    .input(
      z.object({
        currency: currencySchema.optional(),
        name: groupNameSchema,
      }),
    )
    .mutation(async (opts) => {
      const { user } = opts.ctx;

      return db.transaction(async (tx) => {
        const member = await createGroup(tx, {
          createdByUserId: user.id,
          displayName: memberDisplayName(user),
          isoCurrencyCode: opts.input.currency,
          name: opts.input.name,
        });

        await setActiveGroup({ groupId: member.groupId, tx, userId: user.id });

        return { groupId: member.groupId, memberId: member.id };
      });
    }),

  /**
   * Switches which group this user is acting in.
   *
   * Membership is proven here rather than trusted, so the stored preference can
   * never widen what the caller can reach: an id they hold no active seat in is
   * refused, and `resolveActiveMember` re-checks the seat on every request
   * afterwards anyway.
   */
  setActive: protectedProcedure
    .input(z.object({ groupId: z.uuid() }))
    .mutation(async (opts) => {
      const { user } = opts.ctx;
      const { groupId } = opts.input;

      const seat = await db.query.GroupMembers.findFirst({
        where: { userId: user.id, groupId, status: "active" },
        columns: { id: true },
      });

      if (!seat) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "You are not a member of that group",
        });
      }

      await setActiveGroup({ groupId, tx: db, userId: user.id });

      return { groupId, memberId: seat.id };
    }),

  get: groupProcedure.query(async (opts) => {
    const { groupId, member } = opts.ctx;

    const group = await db.query.Groups.findFirst({
      where: { id: groupId },
      columns: { id: true, name: true, isoCurrencyCode: true },
      with: {
        members: {
          columns: { id: true, displayName: true, status: true, role: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
    }

    return {
      id: group.id,
      isoCurrencyCode: group.isoCurrencyCode,
      // Removed seats are included: the ledger and the expense history still
      // reference them, so the client needs a name for every id it can meet.
      members: group.members.map((seat) => ({
        displayName: seat.displayName,
        id: seat.id,
        isYou: seat.id === member.id,
        role: seat.role,
        status: seat.status,
      })),
      myMemberId: member.id,
      name: group.name,
    };
  }),

  rename: ownerProcedure
    .input(z.object({ name: groupNameSchema }))
    .mutation(async (opts) => {
      const [group] = await db
        .update(Groups)
        .set({ name: opts.input.name })
        .where(eq(Groups.id, opts.ctx.groupId))
        .returning({ id: Groups.id, name: Groups.name });

      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      return group;
    }),

  invite: ownerProcedure.input(inviteInputSchema).mutation(async (opts) => {
    const { groupId, member } = opts.ctx;
    const { displayName } = opts.input;

    const email = toNormalizedEmail(opts.input.email);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const invited = await db.transaction(async (tx) => {
      // `group_invites_open_email_key` makes a second open invite for the same
      // address a constraint violation rather than a no-op, so reusing the live
      // row has to be read-then-write. The lock is what keeps a double-tap from
      // 500ing in between the two halves.
      await lockGroup(tx, groupId);

      // The partial unique index only covers *open* invites, so once one has
      // been redeemed nothing stops a second invite for the same address —
      // which would mint a seat `acceptInvite` then refuses to fill, leaving a
      // permanent phantom "Invited" row in the members list.
      const [claimed] = await tx
        .select({ id: GroupMembers.id })
        .from(GroupMembers)
        .innerJoin(users, eq(users.id, GroupMembers.userId))
        .where(
          and(
            eq(GroupMembers.groupId, groupId),
            eq(GroupMembers.status, "active"),
            sql`lower(${users.email}) = ${email}`,
          ),
        )
        .limit(1);

      if (claimed) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "They are already in this group",
        });
      }

      const [open] = await tx
        .select({
          code: GroupInvites.code,
          id: GroupInvites.id,
          memberId: GroupInvites.memberId,
        })
        .from(GroupInvites)
        .where(
          and(
            eq(GroupInvites.groupId, groupId),
            eq(GroupInvites.email, email),
            isNull(GroupInvites.redeemedAt),
            isNull(GroupInvites.revokedAt),
          ),
        )
        .limit(1);

      if (open) {
        // Re-inviting extends the live invite rather than minting a second seat
        // — the first one may already be carrying shares.
        await tx
          .update(GroupInvites)
          .set({ expiresAt })
          .where(
            and(
              eq(GroupInvites.id, open.id),
              eq(GroupInvites.groupId, groupId),
            ),
          );

        // Fixing a typo in the name is the other reason to re-invite. Guarded
        // on `invited` so this path can never rename a claimed seat.
        await tx
          .update(GroupMembers)
          .set({ displayName })
          .where(
            and(
              eq(GroupMembers.id, open.memberId),
              eq(GroupMembers.groupId, groupId),
              eq(GroupMembers.status, "invited"),
            ),
          );

        return {
          code: open.code,
          expiresAt: expiresAt.toISOString(),
          inviteId: open.id,
          memberId: open.memberId,
        };
      }

      // The seat is created up front and exists whether or not the invite is
      // ever accepted: splitting tonight's dinner with a roommate cannot wait on
      // them installing the app.
      const [seat] = await tx
        .insert(GroupMembers)
        .values({ displayName, groupId, role: "member", status: "invited" })
        .returning({ id: GroupMembers.id });

      if (!seat) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create the member seat",
        });
      }

      const [invite] = await tx
        .insert(GroupInvites)
        .values({
          code: inviteCode(),
          email,
          expiresAt,
          groupId,
          invitedByMemberId: member.id,
          memberId: seat.id,
        })
        .returning({
          code: GroupInvites.code,
          expiresAt: GroupInvites.expiresAt,
          id: GroupInvites.id,
        });

      if (!invite) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create the invite",
        });
      }

      return {
        code: invite.code,
        expiresAt: invite.expiresAt.toISOString(),
        inviteId: invite.id,
        memberId: seat.id,
      };
    });

    // After the commit, and never fatal. The invite is on file and the client
    // still has the share sheet and `invites.mine` as delivery paths, so a dead
    // SMTP host must not turn a successful invite into an error the owner will
    // answer by inviting again.
    try {
      const group = await db.query.Groups.findFirst({
        where: { id: groupId },
        columns: { name: true },
      });

      const { subject, html, text } = renderInviteEmail({
        code: invited.code,
        expiresInDays: Math.round(INVITE_TTL_MS / (24 * 60 * 60 * 1000)),
        groupName: group?.name ?? "a group",
        invitedByName: member.displayName,
      });

      await sendEmail({ to: email, subject, html, text });
    } catch (caught) {
      console.error("failed to email an invite", caught);
    }

    return invited;
  }),

  invites: router({
    /**
     * Owner-only: the rows carry the invitee's email address and the code
     * itself, and `revoke` beside it is owner-gated for the same reason.
     */
    list: ownerProcedure.query(async (opts) => {
      const rows = await db
        .select({
          code: GroupInvites.code,
          displayName: GroupMembers.displayName,
          email: GroupInvites.email,
          expiresAt: GroupInvites.expiresAt,
          id: GroupInvites.id,
          revokedAt: GroupInvites.revokedAt,
        })
        .from(GroupInvites)
        .innerJoin(GroupMembers, eq(GroupMembers.id, GroupInvites.memberId))
        .where(
          and(
            eq(GroupInvites.groupId, opts.ctx.groupId),
            isNull(GroupInvites.redeemedAt),
            isNull(GroupInvites.revokedAt),
          ),
        )
        .orderBy(asc(GroupInvites.createdAt));

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
        const [revoked] = await db
          .update(GroupInvites)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(GroupInvites.id, opts.input.inviteId),
              eq(GroupInvites.groupId, opts.ctx.groupId),
              isNull(GroupInvites.redeemedAt),
              isNull(GroupInvites.revokedAt),
            ),
          )
          .returning({ id: GroupInvites.id });

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
     * A `protectedProcedure` and never a `groupProcedure`, for the reason spelled
     * out on `acceptInvite`: resolving a group bootstraps one, and asking "who has
     * invited me?" must not have creating a group as a side effect.
     *
     * This does not weaken the code. Authorization for accepting is already the
     * verified-email match — the code is only a capability that travels — and this
     * query is scoped by that same predicate, so it discloses nothing to a caller
     * who could not already accept.
     */
    mine: protectedProcedure.query(async (opts) => {
      const { user } = opts.ctx;

      if (!user.emailVerified) return [];

      const rows = await db
        .select({
          expiresAt: GroupInvites.expiresAt,
          groupName: Groups.name,
          id: GroupInvites.id,
          invitedByName: Inviter.displayName,
          /** The seat's name, which the inviter chose — "Sam", not your email. */
          seatName: Seat.displayName,
        })
        .from(GroupInvites)
        .innerJoin(Groups, eq(Groups.id, GroupInvites.groupId))
        .innerJoin(Inviter, eq(Inviter.id, GroupInvites.invitedByMemberId))
        .innerJoin(Seat, eq(Seat.id, GroupInvites.memberId))
        .where(
          and(
            sql`lower(${GroupInvites.email}) = ${toNormalizedEmail(user.email)}`,
            isNull(GroupInvites.redeemedAt),
            isNull(GroupInvites.revokedAt),
            // Unlike `list`, which keeps expired rows so an owner can re-send: an
            // expired invite here is a button that cannot work.
            gt(GroupInvites.expiresAt, sql`now()`),
          ),
        )
        .orderBy(asc(GroupInvites.createdAt));

      return rows.map((row) => ({
        ...row,
        expiresAt: row.expiresAt.toISOString(),
      }));
    }),
  }),

  /**
   * Deliberately NOT a `groupProcedure`. Resolving a group here would bootstrap
   * one for the caller on the way in, and they would then be joining from inside
   * a competing group they never asked for.
   */
  acceptInvite: protectedProcedure
    .input(
      z.union([
        z.object({ code: z.string() }),
        /**
         * Accepting one off `invites.mine`, where there is no code to type.
         *
         * The id is deliberately **not** a bearer token: the verified-email match
         * below runs identically for both inputs, so holding an invite id you were
         * not sent gets the same `NOT_FOUND` as holding a stranger's code.
         */
        z.object({ inviteId: z.uuid() }),
      ]),
    )
    .mutation(async (opts) => {
      const { user } = opts.ctx;

      // The code travels through a share sheet, so it cannot be the guard: a
      // forwarded screenshot must not hand a stranger every expense in the group.
      // The real check is the address on the invite matching a *verified*
      // session, which is why an unverified one is refused outright rather than
      // being allowed to prove ownership of an address it never demonstrated.
      if (!user.emailVerified) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Verify your email address before joining a group",
        });
      }

      // `code` is globally unique and `id` is the primary key, so either one
      // identifies at most one invite without needing a group to scope it.
      const invite = await db.query.GroupInvites.findFirst({
        where:
          "code" in opts.input
            ? { code: opts.input.code.trim().toUpperCase() }
            : { id: opts.input.inviteId },
        columns: {
          id: true,
          groupId: true,
          memberId: true,
          email: true,
          expiresAt: true,
          revokedAt: true,
          redeemedAt: true,
          redeemedByUserId: true,
        },
      });

      // Lowercased on both sides rather than trusting the write path: a row that
      // predates that rule, or one seeded by hand, would otherwise refuse its own
      // addressee forever.
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
        return { groupId: invite.groupId, memberId: invite.memberId };
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

      // Joining is additive: you keep every group you are already in and this one
      // becomes the active choice.
      const alreadyIn = await db.query.GroupMembers.findFirst({
        where: { userId: user.id, groupId: invite.groupId, status: "active" },
        columns: { id: true },
      });

      if (alreadyIn) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "You are already a member of this group",
        });
      }

      return db.transaction(async (tx) => {
        // The whole of single-use lives in this one statement's WHERE. The checks
        // above exist to produce a decent error message; they do not decide
        // anything, because two devices tapping Join at once would both pass them
        // and only one can win here.
        const [redeemed] = await tx
          .update(GroupInvites)
          .set({ redeemedAt: new Date(), redeemedByUserId: user.id })
          .where(
            and(
              eq(GroupInvites.id, invite.id),
              isNull(GroupInvites.redeemedAt),
              isNull(GroupInvites.revokedAt),
              gt(GroupInvites.expiresAt, sql`now()`),
            ),
          )
          .returning({
            groupId: GroupInvites.groupId,
            memberId: GroupInvites.memberId,
          });

        if (!redeemed) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This invite is no longer valid",
          });
        }

        const [seat] = await tx
          .update(GroupMembers)
          .set({ userId: user.id, status: "active", joinedAt: new Date() })
          .where(
            and(
              eq(GroupMembers.id, redeemed.memberId),
              eq(GroupMembers.groupId, redeemed.groupId),
              // Fills the seat the invite already created — never a second one,
              // or every share made against the first would point at a stranger.
              // `invited` also refuses a seat retired while the code was in
              // flight, which would otherwise resurrect a removed member.
              eq(GroupMembers.status, "invited"),
            ),
          )
          .returning({ id: GroupMembers.id });

        if (!seat) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That seat is no longer available",
          });
        }

        // Land them in the group they just joined rather than wherever they
        // happened to be. The preference disambiguates two active seats, so
        // nothing has to be destroyed to make resolution deterministic.
        await setActiveGroup({
          groupId: redeemed.groupId,
          tx,
          userId: user.id,
        });

        return { groupId: redeemed.groupId, memberId: seat.id };
      });
    }),

  removeMember: ownerProcedure
    .input(z.object({ memberId: z.uuid() }))
    .mutation(async (opts) => {
      const { groupId, member } = opts.ctx;
      const { memberId } = opts.input;

      if (memberId === member.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself",
        });
      }

      const group = await db.query.Groups.findFirst({
        where: { id: groupId },
        columns: { isoCurrencyCode: true },
      });

      if (!group) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
      }

      return db.transaction(async (tx) => {
        // Before the balances are read, not after: the retirement is decided on
        // what they say, and an expense committing in between would strand a
        // debt on a seat that has just left.
        await lockGroup(tx, groupId);

        const [target] = await tx
          .select({
            displayName: GroupMembers.displayName,
            id: GroupMembers.id,
            role: GroupMembers.role,
            status: GroupMembers.status,
          })
          .from(GroupMembers)
          .where(
            and(
              eq(GroupMembers.id, memberId),
              eq(GroupMembers.groupId, groupId),
            ),
          )
          .limit(1);

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Member not found",
          });
        }

        if (target.status === "removed") return { memberId };

        if (target.role === "owner") {
          const remainingOwners = await tx
            .select({ id: GroupMembers.id })
            .from(GroupMembers)
            .where(
              and(
                eq(GroupMembers.groupId, groupId),
                eq(GroupMembers.role, "owner"),
                eq(GroupMembers.status, "active"),
                ne(GroupMembers.id, memberId),
              ),
            )
            .limit(1);

          if (remainingOwners.length === 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "A group must keep at least one owner",
            });
          }
        }

        await retireSeat(tx, {
          groupId,
          isoCurrencyCode: group.isoCurrencyCode,
          target,
          voice: "other",
        });

        return { memberId };
      });
    }),

  /**
   * Hands the group to somebody else.
   *
   * Necessary the moment `leave` exists: `invite` hardcodes `role: 'member'` and
   * nothing else ever writes `role`, so without this an owner who wanted out was
   * stuck with a group they could never shed.
   *
   * Demotes the caller in the same statement pair, so the group never
   * momentarily has two owners or none.
   */
  transferOwnership: ownerProcedure
    .input(z.object({ toMemberId: z.uuid() }))
    .mutation(async (opts) => {
      const { groupId, member } = opts.ctx;
      const { toMemberId } = opts.input;

      if (toMemberId === member.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You already own this group",
        });
      }

      return db.transaction(async (tx) => {
        // Same lock every membership write takes: without it two concurrent
        // transfers both read an active target and both demote their caller,
        // and the group ends with no owner at all.
        await lockGroup(tx, groupId);

        const [target] = await tx
          .select({
            displayName: GroupMembers.displayName,
            id: GroupMembers.id,
            status: GroupMembers.status,
            userId: GroupMembers.userId,
          })
          .from(GroupMembers)
          .where(
            and(
              eq(GroupMembers.id, toMemberId),
              eq(GroupMembers.groupId, groupId),
            ),
          )
          .limit(1);

        if (!target || target.status !== "active") {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "That person is not an active member of this group",
          });
        }

        // An unclaimed seat has no user behind it, so handing it the group would
        // leave nobody able to exercise the role — every owner-gated procedure
        // resolves its member from a session.
        if (!target.userId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `${target.displayName} hasn't accepted their invite yet, so they can't own the group.`,
          });
        }

        // The status is re-tested in the statement that promotes, not only in
        // the SELECT above: a seat retired between the two would otherwise be
        // handed a group nobody can then administer.
        const [promoted] = await tx
          .update(GroupMembers)
          .set({ role: "owner" })
          .where(
            and(
              eq(GroupMembers.id, toMemberId),
              eq(GroupMembers.groupId, groupId),
              eq(GroupMembers.status, "active"),
            ),
          )
          .returning({ id: GroupMembers.id });

        if (!promoted) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "That person is no longer an active member of this group",
          });
        }

        await tx
          .update(GroupMembers)
          .set({ role: "member" })
          .where(
            and(
              eq(GroupMembers.id, member.id),
              eq(GroupMembers.groupId, groupId),
            ),
          );

        return { ownerMemberId: toMemberId };
      });
    }),

  /**
   * Leaves the group you are currently in.
   *
   * Retiring rather than deleting, like every other seat retirement: the ledger
   * references this seat forever, so its history has to keep rendering with a
   * name.
   */
  leave: groupProcedure.mutation(async (opts) => {
    const { groupId, member, user } = opts.ctx;

    const group = await db.query.Groups.findFirst({
      where: { id: groupId },
      columns: { isoCurrencyCode: true },
    });

    if (!group) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
    }

    return db.transaction(async (tx) => {
      await lockGroup(tx, groupId);

      const others = await tx
        .select({
          id: GroupMembers.id,
          role: GroupMembers.role,
          status: GroupMembers.status,
        })
        .from(GroupMembers)
        .where(
          and(
            eq(GroupMembers.groupId, groupId),
            ne(GroupMembers.status, "removed"),
            ne(GroupMembers.id, member.id),
          ),
        );

      // Leaving as the last owner of a group somebody can still be in would
      // leave it unadministrable — nobody could invite, remove or rename ever
      // again. Leaving as the last seat *anywhere* is fine: the group goes
      // quiet, and its data stays for whoever still has a balance riding on it.
      //
      // An unclaimed seat counts. Nobody is in it yet, but somebody still can
      // be, and they would arrive to a group with no owner — and no invited
      // seat can be handed the role, because `transferOwnership` needs a user
      // behind it.
      if (
        member.role === "owner" &&
        others.length > 0 &&
        !others.some((seat) => seat.status === "active" && isOwner(seat))
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: others.some((seat) => seat.status === "active")
            ? "You're the only owner. Make somebody else the owner before you leave."
            : "You're the only owner and nobody has accepted their invite yet, so there's nobody to hand the group to. Remove the seats you invited, then leave.",
        });
      }

      await retireSeat(tx, {
        groupId,
        isoCurrencyCode: group.isoCurrencyCode,
        target: { id: member.id, displayName: member.displayName },
        voice: "self",
      });

      // Point them somewhere they can still act. Null rather than a guess:
      // `resolveActiveMember` falls back to their oldest remaining seat, and
      // bootstraps a fresh group only if they now hold none at all.
      await setActiveGroup({ groupId: null, tx, userId: user.id });

      return { groupId };
    });
  }),
});
