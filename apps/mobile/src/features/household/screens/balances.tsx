import { MemberAvatar } from "@/components/member-avatar";
import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import {
  Section,
  SectionContent,
  SectionItem,
  SectionItemContent,
} from "@/components/section";
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
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Link } from "expo-router";
import { CircleCheck, HandCoins } from "lucide-react-native";
import { BalanceHero } from "../components/balance-hero";
import { useBalances } from "../hooks/use-balances";
import { formatSignedCents } from "@/lib/money";

export function Balances() {
  const { query, pairs, owedToYou, youOwe, pending, currency, isShared } =
    useBalances();

  return (
    <RefetchScroll
      refetch={query.refetch}
      isLoading={query.isPending}
      loading={<LoadingBlock />}
      isEmpty={pairs.length === 0}
      empty={
        query.isError ? (
          <LoadError
            title="Couldn't load your balances"
            onRetry={() => void query.refetch()}
          />
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon as={CircleCheck} className="text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>You&apos;re all settled up</EmptyTitle>
              {/* Nothing household-shaped for the only person in the
                  household — a solo user gets the title and no more. */}
              {isShared ? (
                <EmptyDescription>
                  Shared purchases land here the moment somebody owes somebody.
                </EmptyDescription>
              ) : null}
            </EmptyHeader>
            {/* Repeated here because `isEmpty` replaces the body outright, and
                "you're all settled up" is the single most likely state to be
                reading from a payment that should never have been recorded. */}
            {isShared ? (
              <EmptyContent>
                <Link href="/payments" asChild>
                  <Button variant="outline">
                    <Text>See payments</Text>
                  </Button>
                </Link>
              </EmptyContent>
            ) : null}
          </Empty>
        )
      }
    >
      <BalanceHero
        owedToYou={owedToYou}
        youOwe={youOwe}
        pending={pending}
        currency={currency}
      />

      <Section>
        <SectionContent>
          {pairs.map((pair, index) => (
            // The card-edge flags are passed explicitly: SectionContent injects
            // them by inspecting its children, and the Link wrapper hides the
            // SectionItem from that check.
            <Link
              // Keyed on the currency too: the server groups a pair per
              // currency, so owing the same person in USD and EUR is two rows.
              key={`${pair.member.id}:${pair.currency}`}
              href={`/balances/${pair.member.id}`}
              asChild
            >
              <SectionItem
                isFirst={index === 0}
                isLast={index === pairs.length - 1}
              >
                <MemberAvatar displayName={pair.member.displayName} />

                <Text numberOfLines={1} className="min-w-0 flex-1 font-medium">
                  {pair.member.displayName}
                </Text>

                <SectionItemContent
                  // Only money coming to you gets colour; what you owe stays
                  // the row's ordinary foreground.
                  textClassName={cn(
                    "font-medium tabular-nums",
                    pair.cents > 0 ? "text-success" : "text-foreground",
                  )}
                >
                  {formatSignedCents(pair.cents, pair.currency)}
                </SectionItemContent>
              </SectionItem>
            </Link>
          ))}
        </SectionContent>
      </Section>

      {/* Outside the pairs card, and shown even when every pair nets to zero:
          the reason to open it is usually a payment that should not have been
          recorded, and that is exactly when the balance above looks settled. */}
      <Section>
        <SectionContent>
          <Link href="/payments" asChild>
            <SectionItem>
              <Icon as={HandCoins} className="text-foreground size-4" />
              <Text className="min-w-0 flex-1 font-medium">Payments</Text>
              <SectionItemContent />
            </SectionItem>
          </Link>
        </SectionContent>
      </Section>
    </RefetchScroll>
  );
}
