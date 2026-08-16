import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share } from "react-native";

export type PendingInvite =
  RouterOutputs["household"]["invites"]["mine"][number];

/** `scheme` in app.config.ts — the app is the only thing that opens this. */
const JOIN_LINK_PREFIX = "com.sigh10.budget://join/";

export const useInvite = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.invite.mutationOptions({
      onSuccess: async () => {
        // The seat exists the moment the invite does — you can split with
        // someone who hasn't opened the app yet, so the split editor's member
        // list is stale as of now.
        await Promise.all([
          queryClient.invalidateQueries(trpc.household.pathFilter()),
          queryClient.invalidateQueries(trpc.transactions.list.pathFilter()),
        ]);
      },
    }),
  );
};

/**
 * Hands the code to the OS share sheet.
 *
 * The address is in the message on purpose: the code is useless to anyone else,
 * and the person forwarding it has no other way to know that.
 */
export const shareInvite = ({ code, email }: { code: string; email: string }) =>
  Share.share({
    message: `Let's split expenses on Budget. Open this on your phone to join:\n\n${JOIN_LINK_PREFIX}${code}\n\nIt only works when ${email} signs in.`,
  });

/**
 * The invites waiting for this account.
 *
 * Empty for very nearly every user very nearly always, which is the point: it
 * costs one query inside the batch the app already sends, and it is the
 * difference between an invitee finding their invite and never knowing it
 * exists.
 */
export const usePendingInvites = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.household.invites.mine.queryOptions());

  return { query, invites: query.data ?? [] };
};

export const useAcceptInvite = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.household.acceptInvite.mutationOptions({
      onSuccess: async () => {
        // Everything, unscoped: joining moves the user to a different
        // household, and every cached query was answered for the old one.
        await queryClient.invalidateQueries();
      },
    }),
  );
};
