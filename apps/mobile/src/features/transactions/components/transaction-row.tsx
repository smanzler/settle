import { SectionItem } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Link } from "expo-router";
import { View } from "react-native";
import {
  formatAccountLabel,
  formatAttribution,
  formatCategory,
  formatTransactionAmount,
} from "../lib/format";
import type { Transaction } from "../lib/group";
import { MerchantLogo } from "./merchant-logo";
import { MemberStack } from "./member-stack";

/**
 * A `SectionItem` with the card-edge flags passed explicitly.
 *
 * `SectionContent` normally injects them by mapping over its children, which
 * virtualization makes impossible — the SectionList only ever renders one row
 * at a time, so it computes the flags from the item's index instead.
 */
export function TransactionRow({
  transaction,
  isFirst,
  isLast,
}: {
  transaction: Transaction;
  isFirst: boolean;
  isLast: boolean;
}) {
  const { text, isInflow } = formatTransactionAmount({
    amount: transaction.amount,
    currency: transaction.isoCurrencyCode,
  });

  const category = formatCategory(transaction.category);
  const subtitle = [
    category,
    formatAccountLabel({
      name: transaction.accountName,
      mask: transaction.accountMask,
    }),
  ]
    .filter(Boolean)
    .join(" · ");

  // Null whenever the whole amount is yours, which is every row for a solo
  // user and most rows for a shared household.
  const attribution = formatAttribution(transaction);

  return (
    <Link href={`/transaction/${transaction.id}`} asChild>
      <SectionItem isFirst={isFirst} isLast={isLast} size="tall">
        <MerchantLogo
          logoUrl={transaction.logoUrl}
          category={transaction.category}
        />

        <View className="min-w-0 flex-1 gap-0.5">
          <Text numberOfLines={1} className="font-medium">
            {transaction.merchantName ?? transaction.name}
          </Text>

          <View className="flex-row items-center gap-1.5">
            <Text
              numberOfLines={1}
              className="text-muted-foreground shrink text-xs"
            >
              {subtitle}
            </Text>
            {transaction.pending ? (
              <Badge variant="secondary" size="sm">
                <Text>Pending</Text>
              </Badge>
            ) : null}
            {transaction.splitsStale ? (
              <Badge variant="secondary" size="sm">
                <Text>Review split</Text>
              </Badge>
            ) : null}
            {attribution ? (
              <MemberStack
                members={attribution.participants}
                className="ml-auto"
              />
            ) : null}
          </View>
        </View>

        <View className="items-end">
          {/* The primary figure stays the FULL transaction amount — this is a
              bank ledger and it has to match the bank. Your share is secondary. */}
          <Text
            className={cn(
              "font-medium tabular-nums",
              isInflow && "text-success",
              transaction.pending && "opacity-60",
            )}
          >
            {text}
          </Text>
          {attribution ? (
            <Text className="text-muted-foreground text-[11px] tabular-nums">
              {attribution.yourShareText}
            </Text>
          ) : null}
        </View>
      </SectionItem>
    </Link>
  );
}
