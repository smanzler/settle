import { SectionContent, SectionItem } from "@/components/section";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { UserPlus } from "lucide-react-native";
import { useHousehold, type Member } from "../hooks/use-household";
import { MemberRow } from "./member-row";

/**
 * Everyone in the household, plus the owner's way to add one.
 *
 * Shared by the Household and Accounts screens, which show the same list with
 * different row affordances. The card-edge arithmetic is the reason this is a
 * component rather than a copied loop: `isLast` depends on whether the invite
 * row renders below it, and getting that wrong silently breaks the card's
 * bottom border.
 */
export function MemberList({
  onMemberPress,
  onRemove,
  onMakeOwner,
  onInvite,
}: {
  onMemberPress?: (member: Member) => void;
  /** Owner-only, and never offered for your own seat. */
  onRemove?: (member: Member) => void;
  /** Owner-only, and only for seats somebody has actually claimed. */
  onMakeOwner?: (member: Member) => void;
  onInvite: () => void;
}) {
  const { members, isOwner } = useHousehold();

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
          onPress={onMemberPress ? () => onMemberPress(member) : undefined}
          onRemove={
            onRemove && isOwner && !member.isYou
              ? () => onRemove(member)
              : undefined
          }
          // `invited` seats are excluded: the server refuses them, because a
          // seat with no user behind it cannot exercise the role.
          onMakeOwner={
            onMakeOwner &&
            isOwner &&
            !member.isYou &&
            member.status === "active"
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
