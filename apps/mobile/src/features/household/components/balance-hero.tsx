import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { View } from "react-native";
import { formatCents } from "@/lib/money";

type Total = { cents: number; currency: string | null };

function Figure({
  label,
  totals,
  fallbackCurrency,
  className,
}: {
  label: string;
  totals: readonly Total[];
  fallbackCurrency: string | null;
  className?: string;
}) {
  // A currency you have nothing outstanding in is absent from the list
  // entirely, and a missing figure would read as "we don't know" rather than
  // "nothing".
  const shown =
    totals.length > 0 ? totals : [{ cents: 0, currency: fallbackCurrency }];

  return (
    <View className="min-w-0 flex-1 gap-1">
      <Text className="text-muted-foreground text-xs">{label}</Text>
      {shown.map((total) => (
        <Text
          key={total.currency ?? "default"}
          className={cn("text-2xl font-semibold tabular-nums", className)}
        >
          {formatCents(total.cents, total.currency)}
        </Text>
      ))}
    </View>
  );
}

/**
 * Two figures, never netted into one.
 *
 * Being owed $200 by one person while owing $200 to another is not the same
 * situation as owing nothing, and the single number that says it is hides who
 * to chase. The server returns them separately for that reason — do not add
 * them together here.
 */
export function BalanceHero({
  owedToYou,
  youOwe,
  pending,
  currency,
}: {
  owedToYou: readonly Total[];
  youOwe: readonly Total[];
  pending: readonly Total[];
  currency: string | null;
}) {
  const pendingText = pending
    // Signed from your side, but the caption is about how much of the balance
    // could still move at the bank, which is true in either direction.
    .map((total) => formatCents(Math.abs(total.cents), total.currency))
    .join(" · ");

  return (
    <Card className="gap-3 p-4">
      <View className="flex-row gap-4">
        <Figure
          label="You are owed"
          totals={owedToYou}
          fallbackCurrency={currency}
          className="text-success"
        />
        <Figure label="You owe" totals={youOwe} fallbackCurrency={currency} />
      </View>

      {pending.length > 0 ? (
        <Text className="text-muted-foreground text-xs">
          includes {pendingText} pending
        </Text>
      ) : null}
    </Card>
  );
}
