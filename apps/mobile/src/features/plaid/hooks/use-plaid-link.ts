import { useTRPC, type RouterOutputs } from "@/lib/trpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  createPlaidLinkSession,
  type LinkExit,
  type LinkSuccess,
  type PlaidLinkSession,
} from "react-native-plaid-link-sdk";

type Status = "idle" | "pending" | "error";

/** The account the newly linked one appears to duplicate, if any. */
export type DuplicateAccount =
  RouterOutputs["plaid"]["exchangePublicToken"]["duplicateOf"];

/**
 * Wraps the native Link flow.
 *
 * The client never sees an access token: it hands the one-time public token
 * straight back to the API, which does the exchange server-side.
 */
export const usePlaidLink = () => {
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateAccount>(null);

  // v13 removed `destroy()`, so each open gets a fresh session. Holding it in a
  // ref keeps it from being collected while Link is on screen.
  const sessionRef = useRef<PlaidLinkSession | null>(null);

  const createLinkToken = useMutation(
    trpc.plaid.createLinkToken.mutationOptions(),
  );
  const exchangePublicToken = useMutation(
    trpc.plaid.exchangePublicToken.mutationOptions(),
  );

  const finish = () => {
    sessionRef.current = null;
    setStatus("idle");
  };

  const fail = (message: string) => {
    setError(message);
    setStatus("error");
    sessionRef.current = null;
  };

  const handleSuccess = async (success: LinkSuccess) => {
    try {
      const linked = await exchangePublicToken.mutateAsync({
        publicToken: success.publicToken,
      });

      // pathFilter, not queryFilter: the transaction list is an *infinite*
      // query, and a `type: "query"` filter silently matches nothing.
      await Promise.all([
        queryClient.invalidateQueries(trpc.plaid.pathFilter()),
        queryClient.invalidateQueries(trpc.transactions.list.pathFilter()),
      ]);

      // The one thing Link cannot tell the user itself: this bank is already
      // connected, so its transactions are about to appear twice. Surfaced
      // rather than acted on — muting the wrong side of a mask collision would
      // hide real history, and only the user knows which is which.
      setDuplicate(linked.duplicateOf);

      finish();
    } catch (caught) {
      console.error(caught);
      fail("We couldn't finish connecting that account.");
    }
  };

  const handleExit = (exit: LinkExit) => {
    // No error means the user backed out on purpose. Saying anything here is a
    // classic bug — they know what they did.
    if (!exit.error) {
      finish();
      return;
    }

    console.error(exit.error);
    fail(exit.error.displayMessage ?? "Something went wrong in Plaid.");
  };

  /** Pass an `itemId` to re-authenticate an existing connection. */
  const open = async (itemId?: string) => {
    setStatus("pending");
    setError(null);
    setDuplicate(null);

    try {
      // Fetched on press, never prefetched: link tokens are short-lived,
      // single-session, and update mode needs a specific item.
      const { linkToken } = await createLinkToken.mutateAsync(
        itemId ? { itemId } : {},
      );

      const session = await createPlaidLinkSession({
        token: linkToken,
        onSuccess: (success) => void handleSuccess(success),
        onExit: handleExit,
        // Required by the type even when we don't need the telemetry.
        onEvent: () => {},
      });

      sessionRef.current = session;

      // Resolves when Link is *presented*, not when it finishes — so status
      // stays pending until onSuccess or onExit fires.
      await session.open();
    } catch (caught) {
      console.error(caught);
      fail("We couldn't open Plaid. Please try again.");
    }
  };

  return {
    dismissDuplicate: () => setDuplicate(null),
    duplicate,
    error,
    isPending: status === "pending" || exchangePublicToken.isPending,
    open,
  };
};
