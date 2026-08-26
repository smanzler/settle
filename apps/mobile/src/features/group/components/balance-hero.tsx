import { Card } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

/** "You're owed $42.10" / "You owe $18.00" / "You're all settled up". */
const formatPosition = (netCents: number, currency: string | null): string => {
  if (netCents === 0) return "You're all settled up";

  return netCents > 0
    ? `You're owed ${formatCents(netCents, currency)}`
    : `You owe ${formatCents(-netCents, currency)}`;
};

/**
 * Your own position, in one sentence.
 *
 * One figure, not two: the ledger nets your share of every expense against
 * every payment you have made, and the sign of that single number is the whole
 * answer. It is a position against the group, not against any one person — who
 * to pay is the settle-up list below it.
 */
export function BalanceHero({
  netCents,
  currency,
}: {
  netCents: number;
  currency: string | null;
}) {
  return (
    <Card className="gap-1 p-4">
      <Text
        className={cn(
          "text-2xl font-semibold tabular-nums",
          netCents > 0 && "text-success",
          netCents < 0 && "text-destructive",
        )}
      >
        {formatPosition(netCents, currency)}
      </Text>
      {/* The same caveat at zero as at any other figure: your net says nothing
          about the other members, who can still owe each other. */}
      <Text className="text-muted-foreground text-xs">
        Across the whole group, not one person.
      </Text>
    </Card>
  );
}
