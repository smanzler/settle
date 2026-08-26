import { Text } from "@/components/ui/text";
import { formatCents } from "@/lib/money";
import { View } from "react-native";
import type { ExpenseSection } from "../lib/by-day";

/**
 * The heading over one day of expenses, with what the day cost.
 *
 * It carries the page background because the SectionList makes it sticky: a
 * transparent header would let the rows scroll through it.
 */
export function ExpenseDayHeader({
  section,
  currency,
}: {
  section: ExpenseSection;
  currency: string | null;
}) {
  return (
    <View className="bg-background flex-row items-baseline justify-between px-1 pb-2 pt-4">
      <Text className="text-muted-foreground text-sm font-medium">
        {section.title}
      </Text>
      <Text className="text-muted-foreground text-xs tabular-nums">
        {formatCents(section.totalCents, currency)}
      </Text>
    </View>
  );
}
