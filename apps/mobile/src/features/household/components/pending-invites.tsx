import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { useRouter } from "expo-router";
import { MailOpen } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import {
  useAcceptInvite,
  usePendingInvites,
  type PendingInvite,
} from "../hooks/use-invite";
import { formatJoinError } from "../lib/errors";

/**
 * "Sam invited you to Flat 3" — with a button, on the first screen of the app.
 *
 * Deliberately a banner above the list rather than a row inside it. Both the
 * transaction list and the balances list swap their children out for an empty
 * state, and a brand-new invitee — who has connected no bank and owes nobody —
 * is in exactly that state, so anything rendered as list content would be
 * invisible to the only people this is for.
 *
 * Renders nothing when there is nothing waiting, which is almost always.
 */
export function PendingInvites() {
  const { invites } = usePendingInvites();

  if (invites.length === 0) return null;

  return (
    <View className="gap-2 px-4 pt-3">
      {invites.map((invite) => (
        <InviteBanner key={invite.id} invite={invite} />
      ))}
    </View>
  );
}

function InviteBanner({ invite }: { invite: PendingInvite }) {
  const router = useRouter();
  const accept = useAcceptInvite();
  const [error, setError] = useState<string | null>(null);

  const handleAccept = async () => {
    setError(null);

    try {
      // By id, not by code: there is no code on this screen, and the server
      // re-checks the invited address against the session either way — so the id
      // is not a capability, just a name for which invite.
      await accept.mutateAsync({ inviteId: invite.id });
      router.push("/balances");
    } catch (caught) {
      console.error(caught);
      setError(formatJoinError(caught));
    }
  };

  return (
    <Card className="gap-2 p-3">
      <View className="flex-row items-center gap-2">
        <Icon as={MailOpen} className="text-foreground size-4" />
        <Text className="min-w-0 flex-1 font-medium" numberOfLines={2}>
          {invite.invitedByName} invited you to {invite.householdName}
        </Text>
      </View>

      <Text className="text-muted-foreground text-xs">
        You&apos;ll share transactions and balances with everyone in it, as{" "}
        {invite.seatName}. Accounts you mark private stay yours alone.
      </Text>

      {error ? <Text className="text-destructive text-xs">{error}</Text> : null}

      <View className="flex-row gap-2">
        <Button
          size="sm"
          disabled={accept.isPending}
          onPress={() => void handleAccept()}
        >
          {accept.isPending ? (
            <Spinner className="text-primary-foreground" />
          ) : null}
          <Text>Join</Text>
        </Button>
      </View>
    </Card>
  );
}
