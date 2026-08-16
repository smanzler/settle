import { LoadMoreButton } from "../components/load-more-button";
import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import { Section, SectionContent, SectionItem } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { formatDayHeading } from "@/features/transactions/lib/group";
import { cn } from "@/lib/utils";
import { Stack, useLocalSearchParams } from "expo-router";
import { Receipt } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { SettleUpSheet } from "../components/settle-up-sheet";
import {
  usePairActivity,
  usePairMember,
  useBalances,
  type ActivityEntry,
} from "../hooks/use-balances";
import { formatOwes, formatSignedCents } from "@/lib/money";

const KIND_LABEL = {
  settlement: "Settlement",
  adjustment: "Adjustment",
} as const;

/**
 * What the row is called.
 *
 * The memo is frozen onto the entry when it is posted, so a share still reads
 * "Luigi's" long after its transaction has been purged — and a voided payment
 * reads "Voided", which is why the reversal is legible as its own row.
 */
const formatEntryTitle = (entry: ActivityEntry, name: string): string => {
  if (entry.memo) return entry.memo;

  switch (entry.kind) {
    case "settlement":
      // A payment you made cancels debt, so it lands positive here whichever
      // way the pair points.
      return entry.cents > 0 ? `You paid ${name}` : `${name} paid you`;
    case "adjustment":
      return "Adjustment";
    case "share":
      return "Shared purchase";
  }
};

/**
 * The audit view — the screen that answers "why do I owe $88".
 *
 * Every entry between exactly these two people, in date order, with nothing
 * rolled up: the balance is only believable if each number traces to something
 * that happened.
 */
export function PairActivity() {
  const { memberId } = useLocalSearchParams<{ memberId: string }>();

  const member = usePairMember(memberId);
  const { pairs, currency } = useBalances();
  const { query, entries, loadMore } = usePairActivity(memberId);

  const [settling, setSettling] = useState(false);

  const pair = pairs.find((row) => row.member.id === memberId) ?? null;
  const name = member?.displayName ?? pair?.member.displayName ?? "Member";
  // Absent from `pairs` means the two of you net to zero, not that the history
  // is empty.
  const netCents = pair?.cents ?? 0;
  const pairCurrency = pair?.currency ?? currency;

  return (
    <>
      <Stack.Screen options={{ title: name }} />

      <RefetchScroll
        refetch={query.refetch}
        isLoading={query.isPending}
        loading={<LoadingBlock />}
        isEmpty={entries.length === 0}
        empty={
          query.isError ? (
            <LoadError
              title="Couldn't load this activity"
              onRetry={() => void query.refetch()}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon as={Receipt} className="text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>Nothing between you two yet</EmptyTitle>
                <EmptyDescription>
                  Shared purchases and payments show up here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        }
      >
        <View className="gap-3">
          <Text className="text-2xl font-semibold tabular-nums">
            {formatOwes({ name, cents: netCents, currency: pairCurrency })}
          </Text>

          {netCents < 0 ? (
            <Button onPress={() => setSettling(true)}>
              <Text>Settle up</Text>
            </Button>
          ) : null}
        </View>

        <Section>
          <SectionContent>
            {entries.map((entry, index) => (
              <SectionItem
                key={entry.id}
                isFirst={index === 0}
                isLast={index === entries.length - 1}
                size="tall"
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text numberOfLines={1} className="font-medium">
                    {formatEntryTitle(entry, name)}
                  </Text>

                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-muted-foreground text-xs">
                      {formatDayHeading(entry.effectiveDate)}
                    </Text>
                    {entry.kind === "share" ? null : (
                      <Badge variant="secondary" size="sm">
                        <Text>{KIND_LABEL[entry.kind]}</Text>
                      </Badge>
                    )}
                  </View>
                </View>

                <Text
                  className={cn(
                    "font-medium tabular-nums",
                    entry.cents > 0 && "text-success",
                  )}
                >
                  {formatSignedCents(entry.cents, entry.currency)}
                </Text>
              </SectionItem>
            ))}
          </SectionContent>
        </Section>

        <LoadMoreButton
          hasNextPage={query.hasNextPage}
          isFetchingNextPage={query.isFetchingNextPage}
          onPress={loadMore}
        />
      </RefetchScroll>

      {/* Outside RefetchScroll: on iOS DialogOverlay wraps itself in a
          FullWindowOverlay, which does not belong inside a scroll view. */}
      <SettleUpSheet
        memberId={memberId}
        displayName={name}
        outstandingCents={netCents < 0 ? -netCents : 0}
        currency={pairCurrency}
        open={settling}
        onOpenChange={setSettling}
      />
    </>
  );
}
