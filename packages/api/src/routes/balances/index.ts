import { TRPCError } from "@trpc/server";
import db from "../../db";
import { toMemberRef } from "../../lib/group";
import {
  getGroupImbalance,
  listGroupBalances,
  verifyLedger,
} from "../../lib/ledger";
import { simplify } from "../../lib/settle-up";
import { groupProcedure, ownerProcedure, router } from "../../lib/trpc";

const loadGroup = async (groupId: string) => {
  const group = await db.query.Groups.findFirst({
    where: { id: groupId },
    columns: { isoCurrencyCode: true },
    with: {
      members: {
        columns: { id: true, displayName: true, status: true },
      },
    },
  });

  if (!group) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Group not found" });
  }

  return group;
};

export const balancesRouter = router({
  /**
   * Where everybody stands, biggest creditor first.
   *
   * `netCents` is signed the way the ledger stores it: **positive means the
   * group owes them.** There is no "since last settlement" window and no period
   * close — a settlement is simply more entries, so this one number is always
   * the whole answer.
   */
  summary: groupProcedure.query(async (opts) => {
    const { groupId, member } = opts.ctx;

    const [group, balances] = await Promise.all([
      loadGroup(groupId),
      listGroupBalances(groupId),
    ]);

    const seats = new Map(group.members.map((seat) => [seat.id, seat]));

    return {
      isoCurrencyCode: group.isoCurrencyCode,
      members: balances.map((balance) => ({
        ...toMemberRef({
          fallbackId: balance.memberId,
          member: seats.get(balance.memberId),
          youId: member.id,
        }),
        netCents: balance.netCents,
      })),
      yourNetCents:
        balances.find((balance) => balance.memberId === member.id)?.netCents ??
        0,
    };
  }),

  /**
   * The smallest set of payments that squares everyone up.
   *
   * Recomputed on every request and never stored — a saved suggestion is wrong
   * the moment the next expense lands, and a wrong suggestion is worse than
   * none. Recording one of these is a `settlements.create` like any other.
   */
  settleUp: groupProcedure.query(async (opts) => {
    const { groupId, member } = opts.ctx;

    const [group, balances] = await Promise.all([
      loadGroup(groupId),
      listGroupBalances(groupId),
    ]);

    const seats = new Map(group.members.map((seat) => [seat.id, seat]));

    const named = (memberId: string) =>
      toMemberRef({
        fallbackId: memberId,
        member: seats.get(memberId),
        youId: member.id,
      });

    return {
      isoCurrencyCode: group.isoCurrencyCode,
      transfers: simplify(balances).map((transfer) => ({
        amountCents: transfer.amountCents,
        from: named(transfer.fromMemberId),
        to: named(transfer.toMemberId),
      })),
    };
  }),

  /**
   * Recomputes every position from the expenses and settlements themselves and
   * reports anyone the ledger disagrees with.
   *
   * Owner-only because it is a diagnostic, not a feature: a healthy group always
   * answers `{ imbalance: 0, drift: [] }`. Anything else means a post or a
   * reversal was missed, and the number on somebody's screen is wrong.
   */
  verify: ownerProcedure.query(async (opts) => {
    const { groupId } = opts.ctx;

    const [drift, imbalance] = await Promise.all([
      verifyLedger(groupId),
      getGroupImbalance(groupId),
    ]);

    return { drift, imbalance };
  }),
});
