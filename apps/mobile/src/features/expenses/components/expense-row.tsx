import { SectionItem } from "@/components/section";
import { Text } from "@/components/ui/text";
import { formatCents, formatSignedCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Link } from "expo-router";
import { View } from "react-native";
import type { Expense } from "../lib/by-day";
import { MemberStack } from "./member-stack";

/**
 * "You paid" / "Alex paid" / "2 people paid".
 *
 * Names are only worth the width when there is one of them; past that the count
 * says the same thing and the avatar stack shows who.
 */
const formatPayers = (payers: Expense["payers"]): string => {
  const [payer] = payers;
  if (payers.length !== 1 || !payer) return `${payers.length} people paid`;

  return payer.isYou ? "You paid" : `${payer.displayName} paid`;
};

/**
 * A `SectionItem` with the card-edge flags passed explicitly.
 *
 * `SectionContent` normally injects them by mapping over its children, which
 * virtualization makes impossible — the SectionList only ever renders one row
 * at a time, so it computes the flags from the item's index instead.
 */
export function ExpenseRow({
  expense,
  currency,
  isFirst,
  isLast,
}: {
  expense: Expense;
  currency: string | null;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <Link href={`/expense/${expense.id}`} asChild>
      <SectionItem isFirst={isFirst} isLast={isLast} size="tall">
        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="font-medium">
            {expense.description}
          </Text>

          <View className="flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="text-muted-foreground shrink text-xs"
            >
              {formatPayers(expense.payers)}
            </Text>
            <MemberStack members={expense.participants} className="ml-auto" />
          </View>
        </View>

        <View className="items-end">
          {/* The primary figure is the FULL expense — that is the number people
              remember paying. Your own effect on it is secondary. */}
          <Text className="font-medium tabular-nums">
            {formatCents(expense.amountCents, currency)}
          </Text>
          {expense.yourNetCents !== 0 ? (
            <Text
              className={cn(
                "text-[11px] tabular-nums",
                // Positive is money the group owes you, which is the good
                // direction on this row.
                expense.yourNetCents > 0
                  ? "text-success"
                  : "text-muted-foreground",
              )}
            >
              {formatSignedCents(expense.yourNetCents, currency)}
            </Text>
          ) : null}
        </View>
      </SectionItem>
    </Link>
  );
}
