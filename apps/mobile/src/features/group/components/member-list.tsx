import { SectionContent, SectionItem } from "@/components/section";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { UserPlus } from "lucide-react-native";
import { useGroup, type Member } from "../hooks/use-group";
import { MemberRow } from "./member-row";

/**
 * Everyone in the group, plus the owner's way to add one.
 *
 * The card-edge arithmetic is the reason this is a component rather than a loop
 * in the screen: `isLast` depends on whether the invite row renders below it,
 * and getting that wrong silently breaks the card's bottom border.
 */
export function MemberList({
  onRemove,
  onMakeOwner,
  onInvite,
}: {
  /** Owner-only, and never offered for your own seat. */
  onRemove: (member: Member) => void;
  /** Owner-only, and only for seats somebody has actually claimed. */
  onMakeOwner: (member: Member) => void;
  onInvite: () => void;
}) {
  const { members, isOwner } = useGroup();

  return (
    <SectionContent>
      {members.map((member, index) => (
        <MemberRow
          key={member.id}
          member={member}
          isFirst={index === 0}
          // The invite row closes the card when it renders, so a member row is
          // the bottom edge only when it doesn't.
          isLast={!isOwner && index === members.length - 1}
          onRemove={
            isOwner && !member.isYou ? () => onRemove(member) : undefined
          }
          // `invited` seats are excluded: the server refuses them, because a
          // seat with no user behind it cannot exercise the role.
          onMakeOwner={
            isOwner && !member.isYou && member.status === "active"
              ? () => onMakeOwner(member)
              : undefined
          }
        />
      ))}

      {isOwner ? (
        <SectionItem onPress={onInvite} size="tall">
          <Icon as={UserPlus} className="text-foreground size-4" />
          <Text className="font-medium">Invite someone</Text>
        </SectionItem>
      ) : null}
    </SectionContent>
  );
}
