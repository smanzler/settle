import { Text } from "@/components/ui/text";
import { formatApiError } from "@/lib/errors";

/**
 * What a refused mutation says, in the one treatment every sheet uses.
 *
 * Renders nothing when `error` is nullish, so a call site passes the mutation's
 * error straight through without a guard of its own.
 */
export function ApiError({
  error,
  fallback,
}: {
  error: unknown;
  fallback: string;
}) {
  if (!error) return null;

  return (
    <Text className="text-destructive text-sm">
      {formatApiError(error, fallback)}
    </Text>
  );
}
