import { MemberAvatar } from "@/components/member-avatar";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { View } from "react-native";

/** Beyond three, the faces stop being recognisable and start being noise. */
const MAX_FACES = 3;

/**
 * The overlapping avatars that say "this was shared".
 *
 * Rendered at the end of the row's existing subtitle line rather than on a line
 * of its own — a shared transaction should read as the same row with one extra
 * detail, not as a taller, busier row.
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
