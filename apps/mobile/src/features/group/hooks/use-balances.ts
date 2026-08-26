import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import { useQuery } from "@tanstack/react-query";

export type MemberBalance =
  RouterOutputs["balances"]["summary"]["members"][number];

export type Transfer =
  RouterOutputs["balances"]["settleUp"]["transfers"][number];

/**
 * Where every member stands, biggest creditor first.
 *
 * `netCents` is signed against the group and not against you: **positive means
 * the group owes them, negative means they owe the group.** Nothing here says
 * who owes whom — one net position per member is the whole model, and
 * `useSettleUp` is what turns those positions into payments.
 */
export const useBalances = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.balances.summary.queryOptions());

  return {
    currency: query.data?.isoCurrencyCode ?? null,
    members: query.data?.members ?? [],
    query,
    yourNetCents: query.data?.yourNetCents ?? 0,
  };
};

/**
 * The smallest set of payments that squares the group up.
 *
 * The server computes this again on every request and stores none of it, so a
 * transfer is only true while the balances behind it are. Hold one no longer
 * than the screen that shows it.
 */
export const useSettleUp = () => {
  const trpc = useTRPC();
  const query = useQuery(trpc.balances.settleUp.queryOptions());

  return {
    currency: query.data?.isoCurrencyCode ?? null,
    query,
    transfers: query.data?.transfers ?? [],
  };
};
