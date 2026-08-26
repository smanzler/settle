import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import { useLocalSearchParams } from "expo-router";
import { TriangleAlert, UsersRound } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useAcceptInvite } from "../hooks/use-join";
import { formatJoinError } from "../lib/errors";

/**
 * Where `com.sigh10.budget://join/<code>` lands.
 *
 * Joining takes a deliberate press: it spends a one-time invite and switches
 * the active group. The session's address is on screen because that address,
 * and not the code, is what the server matches the invite against.
 *
 * The code is named and the group is not, because no procedure resolves a code
 * without redeeming it — a forwarded code must not disclose who is in the
 * group. The group's name appears once the accept lands the user in it.
 */
export function JoinCode() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { data: session } = authClient.useSession();
  const accept = useAcceptInvite();

  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    setError(null);

    try {
      await accept.mutateAsync({ code });
    } catch (caught) {
      console.error(caught);
      setError(formatJoinError(caught));
    }
  };

  if (!code) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon as={TriangleAlert} className="text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>That link is incomplete</EmptyTitle>
          <EmptyDescription>
            Ask them to send you the invite again.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon as={UsersRound} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>Join this group</EmptyTitle>
        <EmptyDescription>
          You share expenses and balances with everyone in it. Tap Join and you
          land in the group this code belongs to.
        </EmptyDescription>
      </EmptyHeader>

      <EmptyContent>
        <View className="bg-muted w-full items-center rounded-lg py-3">
          <Text className="text-lg font-semibold tracking-[3px]">{code}</Text>
        </View>

        {session ? (
          <Text className="text-muted-foreground text-center text-xs">
            You join as {session.user.email}. An invite only works for the
            address it was sent to.
          </Text>
        ) : null}

        <Button
          className="w-full"
          // `isSuccess` too: the navigation away is one render behind the
          // accept, and a second tap spends nothing.
          disabled={accept.isPending || accept.isSuccess}
          onPress={() => void handleJoin()}
        >
          {accept.isPending ? (
            <Spinner className="text-primary-foreground" />
          ) : null}
          <Text>Join group</Text>
        </Button>

        {error ? (
          <Text className="text-destructive text-center text-sm">{error}</Text>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
