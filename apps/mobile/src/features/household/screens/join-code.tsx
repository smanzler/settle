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
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "expo-router";
import { KeyRound } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { useAcceptInvite, usePendingInvites } from "../hooks/use-invite";
import { formatJoinError } from "../lib/errors";

/** Matches `CODE_LENGTH` and `CODE_ALPHABET` on the server. */
const CODE_LENGTH = 10;

/**
 * Typing an invite code by hand.
 *
 * The backup path, and it has to exist for the code to be one: invites are
 * emailed and listed in-app, but a code read off somebody else's screen — or out
 * of a mail client that cannot open an app link — has nowhere else to go.
 */
export function JoinCode() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const accept = useAcceptInvite();
  const { invites } = usePendingInvites();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The server uppercases and trims anyway; doing it here means the field shows
  // the code in the shape it was printed in, and the length check below counts
  // what the server will actually receive.
  const normalized = code.trim().toUpperCase();

  const handleJoin = async () => {
    setError(null);

    try {
      await accept.mutateAsync({ code: normalized });
      router.replace("/balances");
    } catch (caught) {
      console.error(caught);
      setError(formatJoinError(caught));
    }
  };

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon as={KeyRound} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>Enter your invite code</EmptyTitle>
        <EmptyDescription>
          {invites.length > 0
            ? "You already have an invite waiting on the Transactions screen — you can just tap Join there instead."
            : "It's the 10-character code from the email or link you were sent."}
        </EmptyDescription>
      </EmptyHeader>

      <EmptyContent>
        <Input
          value={code}
          onChangeText={setCode}
          placeholder="ABCD234XYZ"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          className="w-full text-center text-lg tracking-[3px]"
        />

        {session ? (
          <Text className="text-muted-foreground text-xs">
            Joining as {session.user.email} — the invite only works for the
            address it was sent to.
          </Text>
        ) : null}

        <Button
          className="w-full"
          disabled={accept.isPending || normalized.length < CODE_LENGTH}
          onPress={() => void handleJoin()}
        >
          {accept.isPending ? (
            <Spinner className="text-primary-foreground" />
          ) : null}
          <Text>Join household</Text>
        </Button>

        {error ? (
          <View className="w-full">
            <Text className="text-destructive text-center text-sm">
              {error}
            </Text>
          </View>
        ) : null}
      </EmptyContent>
    </Empty>
  );
}
