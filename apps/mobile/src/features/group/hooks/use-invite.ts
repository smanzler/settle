import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Share } from "react-native";
import { useGroup } from "./use-group";

/** One invite this group has sent and nobody has accepted yet. */
export type GroupInvite = RouterOutputs["groups"]["invites"]["list"][number];

/** `scheme` in app.config.ts — the app is the only thing that opens this. */
const JOIN_LINK_PREFIX = "com.sigh10.budget://join/";

export const useInvite = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.invite.mutationOptions({
      onSuccess: async () => {
        // The seat exists the moment the invite does — you can split with
        // somebody who has not opened the app yet — so every member list and
        // every split editor is stale as of now.
        await queryClient.invalidateQueries(trpc.groups.pathFilter());
      },
    }),
  );
};

/**
 * The invites this group is waiting on.
 *
 * Owners only, and the query does not run for anybody else: revoking is
 * owner-gated on the server, so a member would be reading a list they cannot
 * act on. Which seats are unclaimed is already on the member list.
 */
export const useGroupInvites = () => {
  const trpc = useTRPC();
  const { isOwner } = useGroup();

  const query = useQuery(
    trpc.groups.invites.list.queryOptions(undefined, { enabled: isOwner }),
  );

  // Read through `isOwner` as well as gated on it: handing the group over
  // disables the query but leaves its last answer in the cache, and a member
  // must not keep looking at codes only an owner may revoke.
  return { query, invites: isOwner ? (query.data ?? []) : [] };
};

export const useRevokeInvite = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  return useMutation(
    trpc.groups.invites.revoke.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.groups.pathFilter());
      },
    }),
  );
};

/**
 * `Aug 20` — an invite's own expiry, never a hard-coded window.
 *
 * `formatIsoDate` takes a calendar day. An expiry is an instant, and the day it
 * lands on is the device's day, so it is formatted from the instant.
 */
export const formatInviteExpiry = (expiresAt: string) =>
  new Date(expiresAt).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
  });

export const isExpired = (expiresAt: string) =>
  new Date(expiresAt).getTime() <= Date.now();

/**
 * Hands the code to the OS share sheet.
 *
 * A second delivery path, not the only one: the server emails the code as well.
 * The address is in the message on purpose — the code works for that address
 * alone, and the person who forwards it has no other way to know that.
 */
export const shareInvite = ({ code, email }: { code: string; email: string }) =>
  Share.share({
    message: `Let's split expenses on Budget. Open this on your phone to join:\n\n${JOIN_LINK_PREFIX}${code}\n\nIt only works when ${email} signs in.`,
  });
