import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import {
  Section,
  SectionContent,
  SectionDescription,
  SectionHeader,
  SectionItem,
  SectionItemContent,
  SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Link } from "expo-router";
import { CircleCheck, HandCoins } from "lucide-react-native";
import { useState } from "react";
import { BalanceHero } from "../components/balance-hero";
import { BalanceRow } from "../components/balance-row";
import {
  SettleUpSheet,
  type SettlePrefill,
} from "../components/settle-up-sheet";
import { TransferRow } from "../components/transfer-row";
import {
  useBalances,
  useSettleUp,
  type MemberBalance,
} from "../hooks/use-balances";

/**
 * Where everybody stands, and the shortest way out of it.
 *
 * The two queries go out in one batch and are treated as one state: the
 * transfers are derived from the same balances the list shows, so a screen with
 * half of them is a screen that contradicts itself.
 */
export function Balances() {
  const { currency, members, query, yourNetCents } = useBalances();
  const { query: settleUpQuery, transfers } = useSettleUp();

  // The prefill outlives `open` so that the sheet keeps its contents through
  // the closing animation instead of emptying under the user's thumb.
  const [prefill, setPrefill] = useState<SettlePrefill | null>(null);
  const [settling, setSettling] = useState(false);

  const openSheet = (next: SettlePrefill | null) => {
    setPrefill(next);
    setSettling(true);
  };

  // A seat that left and owes nothing is not part of the group any more. One
  // that left and then took a position again stays until it is squared up:
  // a retired seat is still payable, and voiding one of those payments puts the
  // balance back.
  const isOutstanding = (member: MemberBalance) =>
    member.status !== "removed" || member.netCents !== 0;

  const shown = members.filter(isOutstanding);

  // The same rule, because `settlements.create` deliberately keeps a retired
  // seat payable: a debt to somebody who left outlives their membership, and a
  // picker that hid them would leave it unsettleable.
  const payees = members
    .filter((member) => !member.isYou && isOutstanding(member))
    .map((member) => ({ displayName: member.displayName, id: member.id }));

  const isPending = query.isPending || settleUpQuery.isPending;
  const isError = query.isError || settleUpQuery.isError;

  const refetch = async () => {
    await Promise.all([query.refetch(), settleUpQuery.refetch()]);
  };

  return (
    <>
      <RefetchScroll
        refetch={refetch}
        isLoading={isPending}
        loading={<LoadingBlock />}
        isEmpty={isError || shown.length === 0}
        empty={
          isError ? (
            <LoadError
              title="Couldn't load your balances"
              onRetry={() => void refetch()}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon as={CircleCheck} className="text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>Nothing to settle yet</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )
        }
      >
        <BalanceHero netCents={yourNetCents} currency={currency} />

        <Section>
          <SectionHeader>
            <SectionTitle>Everyone</SectionTitle>
            <SectionDescription>
              A plus sign means the group owes them.
            </SectionDescription>
          </SectionHeader>
          <SectionContent>
            {shown.map((balance, index) => (
              <BalanceRow
                key={balance.id}
                balance={balance}
                currency={currency}
                isFirst={index === 0}
                isLast={index === shown.length - 1}
              />
            ))}
          </SectionContent>
        </Section>

        <Section>
          <SectionHeader>
            <SectionTitle>Settle up</SectionTitle>
            <SectionDescription>
              {transfers.length > 0
                ? "The fewest payments that clear the whole group."
                : "Nobody has to pay anybody."}
            </SectionDescription>
          </SectionHeader>

          {transfers.length > 0 ? (
            <SectionContent>
              {transfers.map((transfer, index) => (
                <TransferRow
                  key={`${transfer.from.id}:${transfer.to.id}`}
                  transfer={transfer}
                  currency={currency}
                  // Only your own payments: `settlements.create` forces the
                  // payer to the caller, so nobody else's row is recordable.
                  onRecord={
                    transfer.from.isYou
                      ? () =>
                          openSheet({
                            amountCents: transfer.amountCents,
                            displayName: transfer.to.displayName,
                            memberId: transfer.to.id,
                          })
                      : undefined
                  }
                  isFirst={index === 0}
                  isLast={index === transfers.length - 1}
                />
              ))}
            </SectionContent>
          ) : null}

          {payees.length > 0 ? (
            <Button variant="outline" onPress={() => openSheet(null)}>
              <Text>Record a payment</Text>
            </Button>
          ) : null}
        </Section>

        {/* Shown even when the group is square: the reason to open it is
            usually a payment that should not have been recorded, and that is
            exactly when the balances above look settled. */}
        <Section>
          <SectionContent>
            <Link href="/payments" asChild>
              {/* The edge flags are explicit: the Link wrapper hides this row
                  from the check SectionContent makes on its own children. */}
              <SectionItem isFirst isLast>
                <Icon as={HandCoins} className="text-foreground size-4" />
                <Text className="min-w-0 flex-1 font-medium">Payments</Text>
                <SectionItemContent />
              </SectionItem>
            </Link>
          </SectionContent>
        </Section>
      </RefetchScroll>

      {/* Outside RefetchScroll: on iOS DialogOverlay wraps itself in a
          FullWindowOverlay, which does not belong inside a scroll view. */}
      <SettleUpSheet
        currency={currency}
        open={settling}
        onOpenChange={setSettling}
        payees={payees}
        prefill={prefill}
      />
    </>
  );
}
