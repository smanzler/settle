import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import {
  Section,
  SectionDescription,
  SectionHeader,
  SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { MailOpen } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { formatInviteExpiry } from "../hooks/use-invite";
import {
  useAcceptInvite,
  useMyInvites,
  type MyInvite,
} from "../hooks/use-join";
import { formatJoinError } from "../lib/errors";

/** The length of every code the server mints. */
const CODE_LENGTH = 10;

/**
 * Every way into a group that does not start with a link.
 *
 * The code field stays on screen when no invite is waiting: a code read off
 * somebody else's screen has nowhere else to go.
 */
export function Join() {
  const { query, invites } = useMyInvites();

  return (
    <RefetchScroll
      refetch={query.refetch}
      isLoading={query.isPending}
      loading={<LoadingBlock />}
      isEmpty={invites.length === 0}
      empty={
        query.isError ? (
          <LoadError
            title="Couldn't load your invites"
            onRetry={() => void query.refetch()}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon as={MailOpen} className="text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No invites waiting</EmptyTitle>
              <EmptyDescription>
                An invite shows up here as soon as somebody sends you one. If
                you already have a code, type it in below.
              </EmptyDescription>
            </EmptyHeader>

            <EmptyContent>
              <InviteCodeForm />
            </EmptyContent>
          </Empty>
        )
      }
    >
      {invites.map((invite) => (
        <InviteCard key={invite.id} invite={invite} />
      ))}

      <Section>
        <SectionHeader>
          <SectionTitle>Have a different code?</SectionTitle>
          <SectionDescription>
            Type the {CODE_LENGTH}-character code from the email or the link you
            were sent.
          </SectionDescription>
        </SectionHeader>

        <InviteCodeForm />
      </Section>
    </RefetchScroll>
  );
}

/** One waiting invite: who sent it, which group, and the seat it fills. */
function InviteCard({ invite }: { invite: MyInvite }) {
  const accept = useAcceptInvite();
  const [error, setError] = useState<string | null>(null);

  const handleJoin = async () => {
    setError(null);

    try {
      // By id, not by code: `invites.mine` never returns the code. The server
      // matches the invited address against the session for either input, so an
      // id names an invite without granting one.
      await accept.mutateAsync({ inviteId: invite.id });
    } catch (caught) {
      console.error(caught);
      setError(formatJoinError(caught));
    }
  };

  return (
    <Card className="gap-3 p-4">
      <View className="gap-1">
        <Text className="font-medium">
          {invite.invitedByName} invited you to {invite.groupName}
        </Text>
        <Text className="text-muted-foreground text-sm">
          You join as {invite.seatName}. The invite is good until{" "}
          {formatInviteExpiry(invite.expiresAt)}.
        </Text>
      </View>

      {error ? <Text className="text-destructive text-sm">{error}</Text> : null}

      <View className="flex-row">
        <Button
          size="sm"
          // `isSuccess` too: the navigation away is one render behind the
          // accept, and a second tap spends nothing.
          disabled={accept.isPending || accept.isSuccess}
          onPress={() => void handleJoin()}
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

/**
 * The typed-code path, rendered both under the list and in the empty state —
 * which is why the copy that says what a code is belongs to the caller.
 */
function InviteCodeForm() {
  const { data: session } = authClient.useSession();
  const accept = useAcceptInvite();

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The server trims and uppercases too. Doing it here shows the code in the
  // shape it was printed in, and counts the length of what the server gets.
  const normalized = code.trim().toUpperCase();

  const handleJoin = async () => {
    setError(null);

    try {
      await accept.mutateAsync({ code: normalized });
    } catch (caught) {
      console.error(caught);
      setError(formatJoinError(caught));
    }
  };

  return (
    <View className="w-full gap-3">
      <Input
        value={code}
        onChangeText={(text) => {
          setCode(text);
          setError(null);
        }}
        placeholder="ABCD234XYZ"
        autoCapitalize="characters"
        autoCorrect={false}
        returnKeyType="go"
        onSubmitEditing={() => void handleJoin()}
        className="w-full text-center text-lg tracking-[3px]"
      />

      {session ? (
        <Text className="text-muted-foreground text-center text-xs">
          You join as {session.user.email}. An invite only works for the address
          it was sent to.
        </Text>
      ) : null}

      <Button
        className="w-full"
        // A shorter or longer string cannot be a code, so it is refused here
        // instead of on a round trip.
        disabled={
          accept.isPending ||
          accept.isSuccess ||
          normalized.length !== CODE_LENGTH
        }
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
    </View>
  );
}
