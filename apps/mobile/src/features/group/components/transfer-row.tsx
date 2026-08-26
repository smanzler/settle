import { SectionItem } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { formatCents } from "@/lib/money";
import type { Transfer } from "../hooks/use-balances";

/** "You pay Alex", "Alex pays you", "Alex pays Sam". */
const formatTransferLine = (transfer: Transfer): string => {
  if (transfer.from.isYou) return `You pay ${transfer.to.displayName}`;
  if (transfer.to.isYou) return `${transfer.from.displayName} pays you`;

  return `${transfer.from.displayName} pays ${transfer.to.displayName}`;
};

/**
 * One suggested payment.
 *
 * `onRecord` belongs only to a transfer you are the payer of: `settlements.create`
 * forces the payer to the caller, so the only claim anybody can make is "I paid
 * you" and there is no button to give the other rows.
 */
export function TransferRow({
  transfer,
  currency,
  onRecord,
  isFirst,
  isLast,
}: {
  transfer: Transfer;
  currency: string | null;
  onRecord?: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <SectionItem isFirst={isFirst} isLast={isLast} size="snug">
      <Text numberOfLines={1} className="min-w-0 flex-1 font-medium">
        {formatTransferLine(transfer)}
      </Text>

      <Text className="font-medium tabular-nums">
        {formatCents(transfer.amountCents, currency)}
      </Text>

      {onRecord ? (
        <Button size="sm" variant="outline" onPress={onRecord}>
          <Text>Record payment</Text>
        </Button>
      ) : null}
    </SectionItem>
  );
}
