import { MemberAvatar } from "@/components/member-avatar";
import { SectionItem } from "@/components/section";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Pressable } from "@/components/ui/pressable";
import { Text } from "@/components/ui/text";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Circle, CircleCheck } from "lucide-react-native";
import { View } from "react-native";
import type { Member } from "@/features/group/hooks/use-group";

/**
 * The right edge of the row.
 *
 * `share` is a figure the editor resolved; `money` and `weight` are boxes the
 * user types in. A `weight` also shows the cents it currently resolves to,
 * because a bare "2" says nothing about the money. A `null` in either says the
 * split cannot be resolved yet — no amount, or a box that holds no number.
 */
export type MemberAmount =
  | { kind: "none" }
  | { kind: "share"; cents: number | null }
  | {
      kind: "money";
      /** Follows the member's name in the box's label: "share", "paid". */
      noun: string;
      onChangeText: (value: string) => void;
      value: string;
    }
  | {
      kind: "weight";
      cents: number | null;
      onChangeText: (value: string) => void;
      value: string;
    };

/** The row's tap target. `radio` where only one member can be chosen. */
export type MemberToggle = {
  checked: boolean;
  kind: "checkbox" | "radio";
  onPress: () => void;
};

/**
 * One member inside the split or the payer editor: who they are on the left,
 * what they owe or put in on the right.
 */
export function SplitMemberRow({
  member,
  currency,
  amount,
  toggle,
  isFirst,
  isLast,
}: {
  member: Member;
  currency: string | null;
  amount: MemberAmount;
  /** Absent where the amount says who is in — the several-payer editor. */
  toggle?: MemberToggle;
  isFirst?: boolean;
  isLast?: boolean;
}) {
  const name = member.isYou ? "You" : member.displayName;
  const isOut = toggle?.checked === false;

  return (
    <SectionItem isFirst={isFirst} isLast={isLast} size="snug">
      <MemberAvatar
        displayName={member.displayName}
        alt={name}
        className={cn("size-7", isOut && "opacity-40")}
      />

      <View className="min-w-0 flex-1">
        <Text
          numberOfLines={1}
          className={cn("font-medium", isOut && "text-muted-foreground")}
        >
          {name}
        </Text>
        {member.status === "invited" ? (
          <Text className="text-muted-foreground text-[11px]">
            Hasn&apos;t joined yet
          </Text>
        ) : null}
      </View>

      {/* Nothing on the right when they are out — a $0.00 they did not choose
          reads as a share, and a box reads as a demand. */}
      {amount.kind === "share" ? (
        <Text className="tabular-nums">
          {amount.cents === null ? "—" : formatCents(amount.cents, currency)}
        </Text>
      ) : null}

      {amount.kind === "weight" ? (
        <>
          <Text className="text-muted-foreground text-sm tabular-nums">
            {amount.cents === null ? "—" : formatCents(amount.cents, currency)}
          </Text>
          <Input
            value={amount.value}
            onChangeText={amount.onChangeText}
            keyboardType="number-pad"
            selectTextOnFocus
            placeholder="1"
            aria-label={`${name} shares`}
            className="min-h-9 w-14 text-center tabular-nums"
          />
        </>
      ) : null}

      {amount.kind === "money" ? (
        <Input
          value={amount.value}
          onChangeText={amount.onChangeText}
          keyboardType="decimal-pad"
          selectTextOnFocus
          placeholder="0.00"
          aria-label={`${name} ${amount.noun}`}
          className="min-h-9 w-24 text-right tabular-nums"
        />
      ) : null}

      {toggle ? (
        <Pressable
          onPress={toggle.onPress}
          hitSlop={10}
          accessibilityRole={toggle.kind}
          accessibilityState={{ checked: toggle.checked }}
          accessibilityLabel={
            toggle.kind === "radio"
              ? `${name} paid`
              : `Include ${name} in this split`
          }
        >
          <Icon
            as={toggle.checked ? CircleCheck : Circle}
            className={
              toggle.checked ? "text-primary" : "text-muted-foreground"
            }
          />
        </Pressable>
      ) : null}
    </SectionItem>
  );
}
