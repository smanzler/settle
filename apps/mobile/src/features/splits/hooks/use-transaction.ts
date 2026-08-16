import { useTRPC } from "@/lib/trpc";
import { useQuery } from "@tanstack/react-query";

/**
 * One transaction, its split, and every member who could be given a share.
 *
 * The id comes straight off the URL, so a malformed one is left to the server
 * to reject — the screen renders that as an error rather than guessing.
 */
export const useTransaction = (transactionId: string) => {
  const trpc = useTRPC();

  return useQuery(trpc.transactions.get.queryOptions({ transactionId }));
};
