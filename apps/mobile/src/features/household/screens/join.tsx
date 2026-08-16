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
import { useLocalSearchParams, useRouter } from "expo-router";
import { TriangleAlert, UsersRound } from "lucide-react-native";
import { View } from "react-native";
import { useAcceptInvite } from "../hooks/use-invite";
import { formatJoinError } from "../lib/errors";

/**
 * Where `com.sigh10.budget://join/<code>` lands.
 *
 * Joining is never automatic. It moves the account out of whatever household
 * it is in today, so it takes a deliberate press — and the address the session
 * belongs to is on screen, because that address, not the code, is what the
 * server checks.
 */
export function Join() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const accept = useAcceptInvite();

  const handleJoin = async () => {
    try {
      await accept.mutateAsync({ code });
      router.replace("/balances");
    } catch (error) {
      console.error(error);
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
        <EmptyTitle>Join their household</EmptyTitle>
        <EmptyDescription>
          You&apos;ll share transactions and balances with everyone in it.
          Accounts you mark private stay yours alone.
        </EmptyDescription>
      </EmptyHeader>

      <EmptyContent>
        <View className="bg-muted w-full items-center rounded-lg py-3">
          <Text className="text-lg font-semibold tracking-[3px]">{code}</Text>
        </View>

        {session ? (
          <Text className="text-muted-foreground text-xs">
            Joining as {session.user.email}
          </Text>
        ) : null}

        <Button
          className="w-full"
          disabled={accept.isPending}
          onPress={() => void handleJoin()}
        >
          {accept.isPending ? (
            <Spinner className="text-primary-foreground" />
          ) : null}
          <Text>Join household</Text>
        </Button>

        {accept.isError ? (
          <Text className="text-destructive text-center text-sm">
            {formatJoinError(accept.error)}
          </Text>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
