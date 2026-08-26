import { MemberAvatar } from "@/components/member-avatar";
import { SectionItem } from "@/components/section";
import { Text } from "@/components/ui/text";
import { formatSignedCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import type { MemberBalance } from "../hooks/use-balances";

/**
 * One member's net position against the group.
 *
 * The card-edge flags are passed explicitly: `SectionContent` derives them by
 * inspecting its children, and it cannot see the `SectionItem` behind this
 * wrapper.
 */
export function BalanceRow({
  balance,
  currency,
  isFirst,
  isLast,
}: {
  balance: MemberBalance;
  currency: string | null;
  isFirst: boolean;
  isLast: boolean;
}) {
  const name = balance.isYou ? "You" : balance.displayName;

  return (
    <SectionItem isFirst={isFirst} isLast={isLast}>
      <MemberAvatar displayName={balance.displayName} alt={name} />

      <Text numberOfLines={1} className="min-w-0 flex-1 font-medium">
        {name}
      </Text>

      {/* Both directions get a colour, because the sign is the only thing that
          separates being owed from owing and a minus glyph is easy to miss. */}
      <Text
        className={cn(
          "font-medium tabular-nums",
          balance.netCents > 0 && "text-success",
          balance.netCents < 0 && "text-destructive",
          balance.netCents === 0 && "text-muted-foreground",
        )}
      >
        {formatSignedCents(balance.netCents, currency)}
      </Text>
    </SectionItem>
  );
}
