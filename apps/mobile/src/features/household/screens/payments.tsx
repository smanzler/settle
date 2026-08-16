import { LoadMoreButton } from "../components/load-more-button";
import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import { Section, SectionContent, SectionItem } from "@/components/section";
import { Badge } from "@/components/ui/badge";
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
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { HandCoins } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { formatDayHeading } from "@/features/transactions/lib/group";
import {
  useSettlements,
  useVoidSettlement,
  type Settlement,
} from "../hooks/use-settlements";
import { formatApiError } from "@/lib/errors";

/** "You paid Sam", "Sam paid you", "Sam paid Alex". */
const formatSettlementLine = (settlement: Settlement): string => {
  if (settlement.youPaid) return `You paid ${settlement.toDisplayName}`;
  if (settlement.youAreParty) return `${settlement.fromDisplayName} paid you`;

  return `${settlement.fromDisplayName} paid ${settlement.toDisplayName}`;
};

/**
 * Every repayment in the household, and the only way to take one back.
 *
 * This screen exists because a settlement is the one write in the app that
 * asserts something the app cannot verify: `settlements.create` forces the payer
 * to be the caller, so the only claim anybody can make is "I paid you". A list
 * you can read and a payment you can void is what makes that reviewable.
 */
export function Payments() {
  const { query, settlements, loadMore } = useSettlements();
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
              <SectionItem
                key={settlement.id}
                isFirst={index === 0}
                isLast={index === settlements.length - 1}
                size="tall"
                // Voided payments stay on the list and stay untappable: the
                // record of a withdrawn claim is the point, and there is nothing
                // left to do to it.
                onPress={
                  settlement.voidedAt === null
                    ? () => {
                        setError(null);
                        setPending(settlement);
                      }
                    : undefined
                }
              >
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text
                    numberOfLines={1}
                    className={cn(
                      "font-medium",
                      settlement.voidedAt !== null &&
                        "text-muted-foreground line-through",
                    )}
                  >
                    {formatSettlementLine(settlement)}
                  </Text>

                  <View className="flex-row items-center gap-1.5">
                    <Text className="text-muted-foreground text-xs">
                      {formatDayHeading(settlement.settledOn)}
                    </Text>
                    {settlement.method ? (
                      <Text className="text-muted-foreground text-xs">
                        · {settlement.method}
                      </Text>
                    ) : null}
                    {settlement.voidedAt !== null ? (
                      <Badge variant="secondary" size="sm">
                        <Text>Voided</Text>
                      </Badge>
                    ) : null}
                  </View>
                </View>

                <Text
                  className={cn(
                    "font-medium tabular-nums",
                    settlement.voidedAt !== null &&
                      "text-muted-foreground line-through",
                  )}
                >
                  {formatCents(
                    settlement.amountCents,
                    settlement.isoCurrencyCode,
                  )}
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
                ? `${formatSettlementLine(pending)} ${formatCents(
                    pending.amountCents,
                    pending.isoCurrencyCode,
                  )} on ${formatDayHeading(pending.settledOn)}. Voiding puts that back on the balance and both of you will see it was taken back — the payment stays on the list, struck through.`
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
