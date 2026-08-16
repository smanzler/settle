import type { RouterOutputs } from "@/lib/trpc";
import { useTRPC } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type Member = RouterOutputs["household"]["get"]["members"][number];

/**
 * The household, shaped for the screens.
 *
 * `household.get` includes removed seats so the ledger and the activity feed
 * can name every id they reference — no members list should ever show one.
 */
export const useHousehold = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.household.get.queryOptions());

  const members = (query.data?.members ?? []).filter(
    (member) => member.status !== "removed",
  );
  const you = members.find((member) => member.isYou);

  return {
    ...query,
    members,
    you,
    isOwner: you?.role === "owner",
    /** Every household surface hangs off this: alone, none of them render. */
    isShared: members.length > 1,
  };
};

export const useRemoveMember = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.removeMember.mutationOptions({
      onSuccess: async () => {
        // Balances too: writing a leaver's balance off appends ledger entries.
        await Promise.all([
          queryClient.invalidateQueries(trpc.household.pathFilter()),
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
          queryClient.invalidateQueries(trpc.transactions.list.pathFilter()),
        ]);
      },
    }),
  );
};

/** Every household this account can act in, plus which one is current. */
export const useHouseholdList = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.household.list.queryOptions());

  const households = query.data ?? [];

  return {
    query,
    households,
    active: households.find((row) => row.isActive) ?? null,
    /** No switcher for somebody who is only ever in one place. */
    canSwitch: households.length > 1,
  };
};

/**
 * Switches household.
 *
 * `clear()`, not `invalidateQueries()`. No query key in this app carries a
 * household — scope is resolved server-side from the session, which is what keeps
 * `householdId` off the wire — so every cached entry is an answer for the
 * *previous* household and is not merely stale but wrong. Invalidating would
 * leave the old household's balances on screen under the new one's name until
 * each refetch landed; clearing drops them and every screen remounts empty.
 */
export const useSetActiveHousehold = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.setActive.mutationOptions({
      onSuccess: () => {
        queryClient.clear();
      },
    }),
  );
};

/** Leaves the current household, then falls back to whatever remains. */
export const useLeaveHousehold = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.leave.mutationOptions({
      // Same reasoning as the switcher: the household this session resolves to
      // has changed underneath every cached key.
      onSuccess: () => {
        queryClient.clear();
      },
    }),
  );
};

export const useTransferOwnership = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.transferOwnership.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.household.pathFilter());
      },
    }),
  );
};

/**
 * The household's currency.
 *
 * Invalidates balances and transactions as well as the household: the currency
 * decides which transactions `resolveDefaultSplit` will auto-split at all, so
 * changing it changes what the next sync does — and the hero on Balances is
 * labelled with it.
 */
export const useSetCurrency = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.setCurrency.mutationOptions({
      onSuccess: async () => {
        await Promise.all([
          queryClient.invalidateQueries(trpc.household.pathFilter()),
          queryClient.invalidateQueries(trpc.balances.pathFilter()),
        ]);
      },
    }),
  );
};

/** Who the *next* transaction on an account is owed to. History never moves. */
export const useSetAccountOwner = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.setAccountOwner.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.plaid.pathFilter());
      },
    }),
  );
};

export const useUpdateAccount = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.accounts.update.mutationOptions({
      onSuccess: async () => {
        // Privacy rewrites `transactions.is_private` for every row already in
        // the account, so the list has to be refetched, not just the settings.
        await Promise.all([
          queryClient.invalidateQueries(trpc.plaid.pathFilter()),
          queryClient.invalidateQueries(trpc.transactions.list.pathFilter()),
        ]);
      },
    }),
  );
};
