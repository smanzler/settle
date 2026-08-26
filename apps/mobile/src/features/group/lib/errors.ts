import type { AppRouter } from "@budget/api";
import { isTRPCClientError } from "@trpc/client";

const WRITE_OFF_INSTRUCTION = "Write the balance off";

/**
 * The sentence `groups.removeMember` and `groups.leave` refuse with while the
 * seat still has a balance, or `null` for every other failure.
 *
 * The code alone can't decide this: PRECONDITION_FAILED also covers "a group
 * must keep at least one owner" and a currency that is already fixed, and no
 * write-off repairs those. The trailing instruction is dropped — the dialog's
 * own button says it better.
 */
export const outstandingBalanceRefusal = (error: unknown): string | null => {
  if (!isTRPCClientError<AppRouter>(error)) return null;
  if (error.data?.code !== "PRECONDITION_FAILED") return null;

  const at = error.message.indexOf(WRITE_OFF_INSTRUCTION);

  return at === -1 ? null : error.message.slice(0, at).trim();
};

const JOIN_ERRORS: Record<string, string> = {
  BAD_REQUEST: "This invite has expired. Ask them to send you a new one.",
  FORBIDDEN:
    "Your email address isn't verified yet. Sign out, sign back in with the code we email you, then open the link again.",
  NOT_FOUND:
    "This invite was sent to a different email address. Sign in as the person it was addressed to, then open the link again.",
};

/**
 * Why the join failed, in words.
 *
 * CONFLICT deliberately falls through to the server's own sentence: it covers
 * two different refusals — the invite was already used, and you are already in
 * this group — and one line of copy would be wrong for one of them.
 */
export const formatJoinError = (error: unknown): string => {
  // No `data` means it never reached the router — a dropped connection, not a
  // refusal, and none of the copy above applies to it.
  if (!isTRPCClientError<AppRouter>(error) || !error.data) {
    return "Something went wrong. Please try again.";
  }

  return JOIN_ERRORS[error.data.code] ?? error.message;
};
