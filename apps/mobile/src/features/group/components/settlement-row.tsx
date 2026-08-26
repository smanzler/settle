import { SectionItem } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { formatDayHeading } from "@/lib/date";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { View } from "react-native";
import type { Settlement } from "../hooks/use-settlements";

/**
 * "You paid Sam", "Sam paid you", "Sam paid Alex".
 *
 * Both names travel on every row because you are on neither side of a payment
 * between two other members, and "the other party" means nothing there.
 */
export const formatSettlementLine = (settlement: Settlement): string => {
  if (settlement.youPaid) return `You paid ${settlement.toDisplayName}`;
  if (settlement.youAreParty) return `${settlement.fromDisplayName} paid you`;

  return `${settlement.fromDisplayName} paid ${settlement.toDisplayName}`;
};

/**
 * One recorded repayment.
 *
 * `onVoid` opens the confirm dialog the screen owns. A voided row never gets
 * one: the record of a withdrawn claim is the point, and there is nothing left
 * to do to it.
 */
export function SettlementRow({
  settlement,
  currency,
  onVoid,
  isFirst,
  isLast,
}: {
  settlement: Settlement;
  currency: string | null;
  onVoid?: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const isVoided = settlement.voidedAt !== null;
  const struck = isVoided && "text-muted-foreground line-through";

  return (
    <SectionItem
      isFirst={isFirst}
      isLast={isLast}
      size="tall"
      onPress={isVoided ? undefined : onVoid}
    >
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className={cn("font-medium", struck)}>
          {formatSettlementLine(settlement)}
        </Text>

        <View className="flex-row items-center gap-1.5">
          <Text className="text-muted-foreground text-xs">
            {formatDayHeading(settlement.settledOn)}
          </Text>
          {settlement.method ? (
            <Text
              numberOfLines={1}
              className="text-muted-foreground shrink text-xs"
            >
              · {settlement.method}
            </Text>
          ) : null}
          {isVoided ? (
            <Badge variant="secondary" size="sm">
              <Text>Voided</Text>
            </Badge>
          ) : null}
        </View>

        {settlement.note ? (
          <Text numberOfLines={2} className="text-muted-foreground text-xs">
            “{settlement.note}”
          </Text>
        ) : null}
      </View>

      <Text className={cn("font-medium tabular-nums", struck)}>
        {formatCents(settlement.amountCents, currency)}
      </Text>
    </SectionItem>
  );
}
