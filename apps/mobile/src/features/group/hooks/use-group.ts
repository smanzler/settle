import type { RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type Member = RouterOutputs["groups"]["get"]["members"][number];

/**
 * Who can go on a new expense or be paid a settlement.
 *
 * An `invited` seat counts: a seat exists before its invite is accepted
 * precisely so that you can split with that person tonight. A `removed` seat
 * keeps the history it is already on, but takes no new share — which is the
 * same rule `assertSplittable` enforces on the server.
 */
export const isSplittable = (member: Member): boolean =>
  member.status !== "removed";

/**
 * The group, shaped for the screens. Every `groups.get` consumer goes through
 * this, so the retired-seat rule and the currency are stated once.
 *
 * `groups.get` itself includes removed seats, so the ledger and an old expense
 * can name every id they reference — no members list should ever show one.
 */
export const useGroup = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.groups.get.queryOptions());

  const members = (query.data?.members ?? []).filter(isSplittable);
  const you = members.find((member) => member.isYou);

  return {
    ...query,
    currency: query.data?.isoCurrencyCode ?? null,
    isOwner: you?.role === "owner",
    members,
    you,
  };
};

/** Every group this account can act in, each flagged with whether it is current. */
export const useGroupList = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.groups.list.queryOptions());

  return { query, groups: query.data ?? [] };
};

/**
 * Switches group.
 *
 * `clear()`, not `invalidateQueries()`. No query key in this app carries a group
 * id — scope is resolved server-side from the session, which is what keeps
 * `groupId` off the wire — so every cached entry is an answer for the *previous*
 * group and is not merely stale but wrong. Invalidating would leave the old
 * group's balances on screen under the new one's name until each refetch landed;
 * clearing drops them and every screen remounts empty.
 */
export const useSetActiveGroup = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.setActive.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
      },
    }),
  );
};

/** A second group — a trip, a flat — and switches straight into it. */
export const useCreateGroup = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.create.mutationOptions({
      // Same reasoning as the switcher: the server makes the new group active,
      // so every cached key now answers for the group left behind.
      onSuccess: () => {
        queryClient.clear();
      },
    }),
  );
};

export const useRenameGroup = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.rename.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.groups.pathFilter());
      },
    }),
  );
};

/**
 * The group's currency.
 *
 * Balances too: every figure on that screen is labelled with the code, and the
 * server only lets this through while there is nothing posted to relabel.
 */
export const useSetCurrency = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.setCurrency.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.groups.pathFilter()),
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
        ]);
      },
    }),
  );
};

export const useRemoveMember = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.removeMember.mutationOptions({
      onSuccess: async () => {
        // Balances and payments too: writing a leaver's balance off records
        // settlements, which is a ledger entry and a row on Payments.
        await Promise.all([
          queryClient.invalidateQueries(trpc.groups.pathFilter()),
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
          queryClient.invalidateQueries(trpc.settlements.pathFilter()),
        ]);
      },
    }),
  );
};

export const useTransferOwnership = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.transferOwnership.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.groups.pathFilter());
      },
    }),
  );
};

/** Leaves the current group, then falls back to whatever remains. */
export const useLeaveGroup = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.leave.mutationOptions({
      // Same reasoning as the switcher: the group this session resolves to has
      // changed underneath every cached key.
      onSuccess: () => {
        queryClient.clear();
      },
    }),
  );
};
