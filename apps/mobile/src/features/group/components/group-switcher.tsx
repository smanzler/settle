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
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Link } from "expo-router";
import { Check, Plus, TicketCheck, UsersRound } from "lucide-react-native";
import { View } from "react-native";
import { useGroupList, useSetActiveGroup } from "../hooks/use-group";

/**
 * Picks which group the app is looking at, and starts another one.
 *
 * Renders even for the single-group case, unlike a plain switcher would: the
 * "New group" and "Join" rows are the only ways to reach a second one, so the
 * card has to be there before there is anything to switch between.
 *
 * Switching is a server write, not client state — scope is resolved from the
 * session so that no procedure ever takes a group id as input — which is why the
 * rows disable while it is in flight rather than moving the highlight
 * optimistically.
 */
export function GroupSwitcher({ onCreate }: { onCreate: () => void }) {
  const { groups, query } = useGroupList();
  const setActive = useSetActiveGroup();

  return (
    <Section>
      <SectionHeader>
        <SectionTitle>Your groups</SectionTitle>
        <SectionDescription>
          Expenses, balances and payments all belong to whichever one is
          selected.
        </SectionDescription>
      </SectionHeader>

      <SectionContent>
        {groups.map((group) => (
          <SectionItem
            key={group.groupId}
            size="tall"
            onPress={
              group.isActive || setActive.isPending
                ? undefined
                : () => setActive.mutate({ groupId: group.groupId })
            }
          >
            <Icon as={UsersRound} className="text-foreground size-4" />

            <View className="min-w-0 flex-1 gap-0.5">
              <Text numberOfLines={1} className="font-medium">
                {group.name}
              </Text>
              {group.role === "owner" ? (
                <Text className="text-muted-foreground text-xs">
                  You own this one
                </Text>
              ) : null}
            </View>

            {group.isActive ? (
              <Badge variant="secondary" size="sm">
                <Text>Current</Text>
              </Badge>
            ) : setActive.isPending &&
              setActive.variables?.groupId === group.groupId ? (
              <Spinner className="text-muted-foreground" />
            ) : (
              // A spacer, not a tick: it holds the column the current row's
              // badge occupies so the names do not shift between rows.
              <Icon as={Check} className="text-muted-foreground/0 size-4" />
            )}
          </SectionItem>
        ))}

        <SectionItem size="tall" onPress={onCreate}>
          <Icon as={Plus} className="text-foreground size-4" />
          <Text className="font-medium">New group</Text>
        </SectionItem>

        {/* The only way into the join screen from inside the app. Everything
            else that reaches it is a deep link out of an invite email, and the
            code can also simply be typed. */}
        <Link href="/join" asChild>
          <SectionItem size="tall" isLast>
            <Icon as={TicketCheck} className="text-foreground size-4" />
            <Text className="font-medium">Join with a code</Text>
          </SectionItem>
        </Link>
      </SectionContent>

      {/* Without this a failed list reads as "you have one group": the rows are
          simply absent, and only the "New group" row is left. */}
      <ApiError error={query.error} fallback="Couldn't load your groups." />
      <ApiError error={setActive.error} fallback="Couldn't switch group." />
    </Section>
  );
}
