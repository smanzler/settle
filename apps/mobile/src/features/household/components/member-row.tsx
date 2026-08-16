import { MemberAvatar } from "@/components/member-avatar";
import { SectionItem } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Crown, Trash2 } from "lucide-react-native";
import { View } from "react-native";
import type { Member } from "../hooks/use-household";

/**
 * A member's row, with the card-edge flags passed explicitly — `SectionContent`
 * only injects them into children that are literally `SectionItem`.
 */
export function MemberRow({
  member,
  isFirst,
  isLast,
  onPress,
  onRemove,
  onMakeOwner,
}: {
  member: Member;
  isFirst: boolean;
  isLast: boolean;
  onPress?: () => void;
  /** Owner-only, and never on your own row: you cannot remove yourself. */
  onRemove?: () => void;
  /**
   * Owner-only, and only for a claimed seat — an unclaimed one has no user
   * behind it to exercise the role.
   */
  onMakeOwner?: () => void;
}) {
  return (
    <SectionItem
      isFirst={isFirst}
      isLast={isLast}
      onPress={onPress}
      size="snug"
    >
      <MemberAvatar displayName={member.displayName} />

      <View className="min-w-0 flex-1 flex-row items-center gap-2">
        <Text numberOfLines={1} className="shrink font-medium">
          {member.displayName}
        </Text>

        {member.isYou ? (
          <Text className="text-muted-foreground text-xs">You</Text>
        ) : null}

        {/* A seat that exists so you can split with them today, held by nobody
            yet. */}
        {member.status === "invited" ? (
          <Badge variant="secondary" size="sm">
            <Text>Invited</Text>
          </Badge>
        ) : null}

        {member.role === "owner" ? (
          <Badge variant="secondary" size="sm">
            <Text>Owner</Text>
          </Badge>
        ) : null}
      </View>

      {onMakeOwner ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          hitSlop={8}
          accessibilityLabel={`Make ${member.displayName} the owner`}
          onPress={onMakeOwner}
        >
          <Icon as={Crown} className="text-muted-foreground size-4" />
        </Button>
      ) : null}

      {onRemove ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          hitSlop={8}
          accessibilityLabel={`Remove ${member.displayName}`}
          onPress={onRemove}
        >
          <Icon as={Trash2} className="text-destructive size-4" />
        </Button>
      ) : null}
    </SectionItem>
  );
}
