import type { AppRouter } from "@budget/api";
import { isTRPCClientError } from "@trpc/client";

/**
 * These procedures refuse in whole sentences; prefer them over our own copy.
 *
 * Gated on `data` rather than on the error being a tRPC one: a dropped
 * connection arrives as a `TRPCClientError` too, and "Network request failed"
 * is not a sentence to put in front of anybody.
 */
export const formatApiError = (error: unknown, fallback: string): string =>
  isTRPCClientError<AppRouter>(error) && error.data ? error.message : fallback;
