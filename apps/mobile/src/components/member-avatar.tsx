import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Text } from "@/components/ui/text";
import { formatMemberInitials } from "@/features/transactions/lib/format";
import { cn } from "@/lib/utils";

/** A member's face — initials until there is a picture to show. */
export function MemberAvatar({
  displayName,
  alt = displayName,
  className,
  textClassName,
}: {
  displayName: string;
  /** Defaults to the display name — pass "You" where the row reads "You". */
  alt?: string;
  className?: string;
  textClassName?: string;
}) {
  return (
    <Avatar alt={alt} className={className}>
      <AvatarFallback>
        <Text className={cn("text-[11px] font-medium", textClassName)}>
          {formatMemberInitials(displayName)}
        </Text>
      </AvatarFallback>
    </Avatar>
  );
}
