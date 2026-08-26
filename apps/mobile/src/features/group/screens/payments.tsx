import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import { Section, SectionContent } from "@/components/section";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { formatIsoDate } from "@/lib/date";
import { formatApiError } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { HandCoins } from "lucide-react-native";
import { useState } from "react";
import { LoadMoreButton } from "../components/load-more-button";
import {
  SettlementRow,
  formatSettlementLine,
} from "../components/settlement-row";
import { useGroup } from "../hooks/use-group";
import {
  useSettlements,
  useVoidSettlement,
  type Settlement,
} from "../hooks/use-settlements";

/**
 * Every repayment in the group, and the only way to take one back.
 *
 * This screen exists because a settlement is the one write in the app that
 * asserts something the app cannot verify: `settlements.create` forces the payer
 * to be the caller, so the only claim anybody can make is "I paid you". A list
 * you can read and a payment you can void is what makes that reviewable.
 */
export function Payments() {
  const { query, settlements, loadMore } = useSettlements();
  // The group's own currency, not the balances': this screen shows no balance,
  // and `groups.get` is already in the cache from the layout above it.
  const { data: group, isOwner } = useGroup();
  const voidSettlement = useVoidSettlement();

  const [pending, setPending] = useState<Settlement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setPending(null);
    setError(null);
  };

  const handleVoid = async () => {
    if (!pending) return;

    setError(null);

    try {
      await voidSettlement.mutateAsync({ settlementId: pending.id });
      close();
    } catch (caught) {
      console.error(caught);
      setError(
        formatApiError(caught, "Couldn't void this payment. Try again."),
      );
    }
  };

  // The list carries no recorder, so `youPaid` stands in for one: every
  // `settlements.create` writes the payer as the recorder too. A balance
  // written off when somebody left is the one row where the two differ, and the
  // server refuses that one — the dialog then shows what it said.
  const canVoid = (settlement: Settlement) => settlement.youPaid || isOwner;

  return (
    <>
      <RefetchScroll
        refetch={query.refetch}
        isLoading={query.isPending}
        loading={<LoadingBlock />}
        isEmpty={settlements.length === 0}
        empty={
          query.isError ? (
            <LoadError
              title="Couldn't load your payments"
              onRetry={() => void query.refetch()}
            />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Icon as={HandCoins} className="text-muted-foreground" />
                </EmptyMedia>
                <EmptyTitle>No payments yet</EmptyTitle>
                <EmptyDescription>
                  Every time somebody settles up, it shows up here so both of
                  you can check it.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        }
      >
        <Section>
          <SectionContent>
            {settlements.map((settlement, index) => (
              <SettlementRow
                key={settlement.id}
                settlement={settlement}
                currency={group?.isoCurrencyCode ?? null}
                onVoid={
                  canVoid(settlement)
                    ? () => {
                        setError(null);
                        setPending(settlement);
                      }
                    : undefined
                }
                isFirst={index === 0}
                isLast={index === settlements.length - 1}
              />
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
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this payment?</DialogTitle>
            <DialogDescription>
              {pending
                ? // The full date, not the row's "Today"/"Yesterday" heading,
                  // which does not read as a date inside a sentence.
                  `${formatSettlementLine(pending)} ${formatCents(
                    pending.amountCents,
                    group?.isoCurrencyCode ?? null,
                  )} on ${formatIsoDate(pending.settledOn)}. Voiding puts that back on the balances and both of you will see it was taken back — the payment stays on the list, struck through.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {pending?.note ? (
            <Text className="text-muted-foreground text-sm">
              “{pending.note}”
            </Text>
          ) : null}

          {error ? (
            <Text className="text-destructive text-sm">{error}</Text>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={voidSettlement.isPending}
              onPress={close}
            >
              <Text>Keep it</Text>
            </Button>
            <Button
              variant="destructive"
              disabled={voidSettlement.isPending}
              onPress={() => void handleVoid()}
            >
              {voidSettlement.isPending ? (
                <Spinner className="text-white" />
              ) : null}
              <Text>Void payment</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
