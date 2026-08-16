import { MemberAvatar } from "@/components/member-avatar";
import { SectionItem } from "@/components/section";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { formatTransactionAmount } from "@/features/transactions/lib/format";
import type { RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { fromCents } from "@budget/shared";
import { Circle, CircleCheck } from "lucide-react-native";
import { Pressable } from "@/components/ui/pressable";
import { View } from "react-native";

export type SplitMember =
  RouterOutputs["transactions"]["get"]["members"][number];

/** The right edge of the row: the share they get, or the box they type it in. */
export type SplitAmount =
  | { kind: "share"; cents: number }
  | { kind: "input"; value: string; onChangeText: (value: string) => void };

export function SplitMemberRow({
  member,
  currency,
  checked,
  onCheckedChange,
  amount,
  isFirst,
  isLast,
}: {
  member: SplitMember;
  currency: string | null;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  amount: SplitAmount;
  isFirst: boolean;
  isLast: boolean;
}) {
  const name = member.isYou ? "You" : member.displayName;

  return (
    <SectionItem isFirst={isFirst} isLast={isLast} size="snug">
      <MemberAvatar
        displayName={member.displayName}
        alt={name}
        className={cn("size-7", !checked && "opacity-40")}
      />

      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className={cn("font-medium", !checked && "text-muted-foreground")}
        >
          {name}
        </Text>
        {member.status === "invited" ? (
          <Text className="text-muted-foreground text-[11px]">
            Hasn&apos;t joined yet
          </Text>
        ) : null}
      </View>

      {/* Nothing on the right when they're out of the split — a $0.00 they
          didn't choose reads as a share, and an input reads as a demand. */}
      {checked && amount.kind === "input" ? (
        <Input
          value={amount.value}
          onChangeText={amount.onChangeText}
          keyboardType="decimal-pad"
          selectTextOnFocus
          placeholder="0.00"
          aria-label={`${name} share`}
          className="min-h-9 w-24 text-right tabular-nums"
        />
      ) : null}

      {checked && amount.kind === "share" ? (
        <Text className="tabular-nums">
          {
            formatTransactionAmount({
              amount: fromCents(amount.cents),
              currency,
            }).text
          }
        </Text>
      ) : null}

      <Pressable
        onPress={() => onCheckedChange(!checked)}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        accessibilityLabel={`Include ${name} in this split`}
      >
        <Icon
          as={checked ? CircleCheck : Circle}
          className={checked ? "text-primary" : "text-muted-foreground"}
        />
      </Pressable>
    </SectionItem>
  );
}
