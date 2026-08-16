import { Text } from "@/components/ui/text";
import { View } from "react-native";
import { formatTransactionAmount } from "../lib/format";
import type { TransactionSection } from "../lib/group";

export function TransactionDayHeader({
  section,
}: {
  section: TransactionSection;
}) {
  // The day's net, run through the same sign interpretation as a row.
  const { text, isInflow } = formatTransactionAmount({
    amount: String(section.total),
    currency: section.currency,
  });

  return (
    <View className="flex-row items-baseline justify-between px-1">
      <Text className="text-muted-foreground text-sm font-medium">
        {section.title}
      </Text>
      {section.total !== 0 ? (
        <Text className="text-muted-foreground text-xs tabular-nums">
          {isInflow ? text : `−${text}`}
        </Text>
      ) : null}
    </View>
  );
}
