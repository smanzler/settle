import { MemberAvatar } from "@/components/member-avatar";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { View } from "react-native";

/** Beyond three, the faces stop being recognisable and start being noise. */
const MAX_FACES = 3;

/**
 * The overlapping avatars that say who is in on an expense.
 *
 * Rendered at the end of the row's existing subtitle line rather than on a line
 * of its own — the people on an expense are one more detail on the row, not a
 * reason to make it taller and busier.
 */
export function MemberStack({
  members,
  className,
}: {
  members: { id: string; displayName: string; isYou: boolean }[];
  className?: string;
}) {
  const shown = members.slice(0, MAX_FACES);
  const overflow = members.length - shown.length;

  return (
    <View className={cn("flex-row items-center", className)}>
      {shown.map((member, index) => (
        <MemberAvatar
          key={member.id}
          displayName={member.displayName}
          // Negative margin on every face but the first is what overlaps them;
          // the ring keeps the edges legible where they touch.
          className={cn(
            "border-background size-5 border-2",
            index > 0 && "-ml-1.5",
          )}
          textClassName="text-[9px]"
        />
      ))}

      {overflow > 0 ? (
        <Text className="text-muted-foreground ml-1 text-[10px] tabular-nums">
          +{overflow}
        </Text>
      ) : null}
    </View>
  );
}
