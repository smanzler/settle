import { ApiError } from "@/components/api-error";
import {
  Section,
  SectionContent,
  SectionDescription,
  SectionHeader,
  SectionItem,
  SectionTitle,
} from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Share2, X } from "lucide-react-native";
import { View } from "react-native";
import {
  formatInviteExpiry,
  isExpired,
  shareInvite,
  useGroupInvites,
  useRevokeInvite,
  type GroupInvite,
} from "../hooks/use-invite";

/**
 * The invites this group has sent and nobody has accepted yet.
 *
 * Renders nothing when there are none and nothing failed, which is the normal
 * state. The seats themselves are already on the member list under an "Invited"
 * badge — what is here and nowhere else is the code, its expiry, and the way to
 * take it back.
 */
export function PendingInvites() {
  const { invites, query } = useGroupInvites();
  const revoke = useRevokeInvite();

  // A failed list still gets a section: an owner who cannot see a code they
  // have sent must be told why, not shown a screen with no invites on it.
  if (invites.length === 0 && !query.isError) return null;

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Pending invites</SectionTitle>
        <SectionDescription>
          Each one was emailed to the address on it and works for that address
          alone. Inviting the same address again extends the invite instead of
          making a second one.
        </SectionDescription>
      </SectionHeader>

      {invites.length > 0 ? (
        <SectionContent>
          {invites.map((invite) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              isPending={revoke.isPending}
              onRevoke={() => revoke.mutate({ inviteId: invite.id })}
            />
          ))}
        </SectionContent>
      ) : null}

      <ApiError error={query.error} fallback="Couldn't load your invites." />
      <ApiError error={revoke.error} fallback="Couldn't cancel the invite." />
    </Section>
  );
}

function InviteRow({
  invite,
  isPending,
  onRevoke,
}: {
  invite: GroupInvite;
  isPending: boolean;
  onRevoke: () => void;
}) {
  const expired = isExpired(invite.expiresAt);

  return (
    <SectionItem size="snug">
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={1} className="shrink font-medium">
            {invite.displayName}
          </Text>
          {/* Kept in the list rather than hidden: an expired invite is the one
              that needs sending again, and the seat is still holding shares. */}
          {expired ? (
            <Badge variant="secondary" size="sm">
              <Text>Expired</Text>
            </Badge>
          ) : null}
        </View>
        <Text numberOfLines={1} className="text-muted-foreground text-xs">
          {invite.email}
          {expired ? "" : ` · Expires ${formatInviteExpiry(invite.expiresAt)}`}
        </Text>
      </View>

      {expired ? null : (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          hitSlop={8}
          accessibilityLabel={`Share ${invite.displayName}'s code`}
          onPress={() =>
            void shareInvite({
              code: invite.code,
              email: invite.email,
            }).catch(console.error)
          }
        >
          <Icon as={Share2} className="text-muted-foreground size-4" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        hitSlop={8}
        disabled={isPending}
        accessibilityLabel={`Cancel the invite to ${invite.displayName}`}
        onPress={onRevoke}
      >
        <Icon as={X} className="text-destructive size-4" />
      </Button>
    </SectionItem>
  );
}
