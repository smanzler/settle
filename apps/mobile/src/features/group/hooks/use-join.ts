import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

/** One invite that waits for this account. */
export type MyInvite = RouterOutputs["groups"]["invites"]["mine"][number];

/** Every unexpired invite addressed to this account, oldest first. */
export const useMyInvites = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.groups.invites.mine.queryOptions());

  return { query, invites: query.data ?? [] };
};

/**
 * Accepts an invite — by `inviteId` off the waiting list, or by `code` from a
 * link — and replaces the current screen with the new group's expenses. A call
 * site does not navigate on success itself.
 */
export const useAcceptInvite = () => {
  const router = useRouter();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.acceptInvite.mutationOptions({
      onSuccess: () => {
        // Same reasoning as `useSetActiveGroup`: the session now resolves to
        // another group, so every cached key answers for the one left behind.
        queryClient.clear();
        // `replace`: the invite is spent, and a screen that offers to accept it
        // again can only fail.
        router.replace("/");
      },
    }),
  );
};
