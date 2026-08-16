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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { View } from "react-native";
import { Coins, UsersRound } from "lucide-react-native";
import { useState } from "react";
import {
  CurrencySheet,
  formatCurrencyLabel,
} from "../components/currency-sheet";
import { InviteSheet } from "../components/invite-sheet";
import { MemberList } from "../components/member-list";
import {
  useHousehold,
  useLeaveHousehold,
  useRemoveMember,
  useTransferOwnership,
  type Member,
} from "../hooks/use-household";
import { formatApiError } from "@/lib/errors";
import { outstandingBalanceRefusal } from "../lib/errors";
import { useRouter } from "expo-router";

export function Household() {
  const household = useHousehold();
  const removeMember = useRemoveMember();
  const transferOwnership = useTransferOwnership();
  const leave = useLeaveHousehold();
  const router = useRouter();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [pending, setPending] = useState<Member | null>(null);
  const [pendingOwner, setPendingOwner] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);
  // The server's own sentence naming what they still owe. Set only once it has
  // refused, so a null here means "no refusal yet", not "nothing owed".
  const [outstanding, setOutstanding] = useState<string | null>(null);
  const [leaveOutstanding, setLeaveOutstanding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const closeRemove = () => {
    setPending(null);
    setOutstanding(null);
    setError(null);
  };

  const handleRemove = async (writeOffBalance: boolean) => {
    if (!pending) return;

    setError(null);

    try {
      await removeMember.mutateAsync({
        memberId: pending.id,
        ...(writeOffBalance ? { writeOffBalance: true } : {}),
      });

      closeRemove();
    } catch (caught) {
      const refusal = outstandingBalanceRefusal(caught);

      // Not a failure yet — they owe money, so the same removal is offered
      // again with the write-off attached.
      if (refusal) {
        setOutstanding(refusal);
        return;
      }

      console.error(caught);
      setError(formatApiError(caught, "Couldn't remove them. Try again."));
    }
  };

  const handleMakeOwner = async () => {
    if (!pendingOwner) return;

    setError(null);

    try {
      await transferOwnership.mutateAsync({ toMemberId: pendingOwner.id });
      setPendingOwner(null);
    } catch (caught) {
      console.error(caught);
      setError(
        formatApiError(caught, "Couldn't hand over the household. Try again."),
      );
    }
  };

  const handleLeave = async (writeOffBalance: boolean) => {
    setLeaveError(null);

    try {
      await leave.mutateAsync(writeOffBalance ? { writeOffBalance: true } : {});

      setLeaving(false);
      // Back to the list, which is now answering for whichever household the
      // session fell back to. `replace`, not `push`: this screen belongs to a
      // household this account is no longer in.
      router.replace("/");
    } catch (caught) {
      const refusal = outstandingBalanceRefusal(caught);

      // Not a failure yet — the same departure is offered again, with the
      // write-off attached.
      if (refusal) {
        setLeaveOutstanding(refusal);
        return;
      }

      console.error(caught);
      setLeaveError(formatApiError(caught, "Couldn't leave. Try again."));
    }
  };

  if (household.isError) {
    return (
      <RefetchScroll
        refetch={household.refetch}
        isEmpty
        empty={
          <LoadError
            title="Couldn't load your household"
            onRetry={() => void household.refetch()}
          />
        }
      />
    );
  }

  return (
    <>
      <RefetchScroll
        refetch={household.refetch}
        isLoading={household.isPending}
        loading={<LoadingBlock />}
        // Nothing about a household is worth showing to someone who is in it
        // alone — the only thing on offer is the person they're missing.
        isEmpty={!household.isShared}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon as={UsersRound} className="text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>Just you in here</EmptyTitle>
              <EmptyDescription>
                Invite the person you share money with and every account can be
                split between you.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onPress={() => setInviteOpen(true)}>
                <Text>Split with someone</Text>
              </Button>
            </EmptyContent>
          </Empty>
        }
      >
        <Section>
          <SectionHeader>
            <SectionTitle>Members</SectionTitle>
            <SectionDescription>
              Everyone here can see and be assigned a share of shared
              transactions.
            </SectionDescription>
          </SectionHeader>

          <MemberList
            onRemove={(member) => {
              setOutstanding(null);
              setError(null);
              setPending(member);
            }}
            onMakeOwner={(member) => {
              setError(null);
              setPendingOwner(member);
            }}
            onInvite={() => setInviteOpen(true)}
          />
        </Section>

        <Section>
          <SectionHeader>
            <SectionTitle>Currency</SectionTitle>
            <SectionDescription>
              {household.data?.currencyLocked === true
                ? "Fixed now that this household has balances — changing it would strand what you already owe each other in a currency nobody could pay off."
                : "Only transactions in this currency are split automatically. Set it before your first shared expense."}
            </SectionDescription>
          </SectionHeader>

          <SectionContent>
            <SectionItem
              // No handler at all when it cannot change: a row that opens a
              // picker whose Save is guaranteed to be refused is worse than a
              // row that reads as settled.
              onPress={
                household.isOwner && household.data?.currencyLocked !== true
                  ? () => setCurrencyOpen(true)
                  : undefined
              }
            >
              <Icon as={Coins} className="text-foreground size-4" />
              <Text className="font-medium">
                {household.data?.defaultCurrency ?? "USD"}
              </Text>
              {household.isOwner && household.data?.currencyLocked !== true ? (
                <SectionItemContent>
                  {formatCurrencyLabel(
                    household.data?.defaultCurrency ?? "USD",
                  )}
                </SectionItemContent>
              ) : (
                <View className="ml-auto">
                  <Text className="text-muted-foreground">
                    {formatCurrencyLabel(
                      household.data?.defaultCurrency ?? "USD",
                    )}
                  </Text>
                </View>
              )}
            </SectionItem>
          </SectionContent>
        </Section>

        <Section>
          <SectionHeader>
            <SectionTitle>Leave</SectionTitle>
            <SectionDescription>
              Your share of past transactions stays on the ledger so the history
              still adds up — you just stop seeing this household.
            </SectionDescription>
          </SectionHeader>

          <Button
            variant="outline"
            disabled={leave.isPending}
            onPress={() => {
              setLeaveError(null);
              setLeaveOutstanding(null);
              setLeaving(true);
            }}
          >
            <Text className="text-destructive">Leave this household</Text>
          </Button>
        </Section>
      </RefetchScroll>

      {/* Outside RefetchScroll, like every other dialog in the app: on iOS
          DialogOverlay wraps itself in a FullWindowOverlay. */}
      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} />

      {/* Keyed on the saved currency so reopening after a save seeds from what
          was saved rather than from the selection that produced it. */}
      <CurrencySheet
        key={household.data?.defaultCurrency ?? "USD"}
        open={currencyOpen}
        onOpenChange={setCurrencyOpen}
      />

      <Dialog
        open={pendingOwner !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingOwner(null);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Make {pendingOwner?.displayName} the owner?
            </DialogTitle>
            <DialogDescription>
              They&apos;ll be able to invite and remove people, rename the
              household and reassign accounts. You become an ordinary member —
              which is what lets you leave, if that&apos;s what you&apos;re
              after.
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <Text className="text-destructive text-sm">{error}</Text>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={transferOwnership.isPending}
              onPress={() => {
                setPendingOwner(null);
                setError(null);
              }}
            >
              <Text>Cancel</Text>
            </Button>
            <Button
              disabled={transferOwnership.isPending}
              onPress={() => void handleMakeOwner()}
            >
              {transferOwnership.isPending ? (
                <Spinner className="text-primary-foreground" />
              ) : null}
              <Text>Hand it over</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={leaving}
        onOpenChange={(open) => {
          if (!open) {
            setLeaving(false);
            setLeaveOutstanding(null);
            setLeaveError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {leaveOutstanding
                ? "Write off your balance and leave?"
                : "Leave this household?"}
            </DialogTitle>
            <DialogDescription>
              {leaveOutstanding
                ? `${leaveOutstanding} Leaving cancels it for good — the ledger keeps the history, but nobody is chasing that money again.`
                : "You'll stop seeing its transactions, accounts and balances. Your share of past transactions stays on the ledger."}
            </DialogDescription>
          </DialogHeader>

          {leaveError ? (
            <Text className="text-destructive text-sm">{leaveError}</Text>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={leave.isPending}
              onPress={() => {
                setLeaving(false);
                setLeaveOutstanding(null);
                setLeaveError(null);
              }}
            >
              <Text>Stay</Text>
            </Button>
            <Button
              variant="destructive"
              disabled={leave.isPending}
              onPress={() => void handleLeave(leaveOutstanding !== null)}
            >
              {leave.isPending ? <Spinner className="text-white" /> : null}
              <Text>{leaveOutstanding ? "Write off & leave" : "Leave"}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) closeRemove();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {outstanding
                ? `Write off ${pending?.displayName}'s balance?`
                : `Remove ${pending?.displayName}?`}
            </DialogTitle>
            <DialogDescription>
              {outstanding
                ? `${outstanding} Removing them cancels it for good — the ledger keeps the history, but nobody is chasing that money again.`
                : "They lose access to this household. Their share of past transactions stays on the ledger."}
            </DialogDescription>
          </DialogHeader>

          {error ? (
            <Text className="text-destructive text-sm">{error}</Text>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={removeMember.isPending}
              onPress={closeRemove}
            >
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="destructive"
              disabled={removeMember.isPending}
              onPress={() => void handleRemove(outstanding !== null)}
            >
              {removeMember.isPending ? (
                <Spinner className="text-white" />
              ) : null}
              <Text>{outstanding ? "Write off & remove" : "Remove"}</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
