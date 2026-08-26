import { ApiError } from "@/components/api-error";
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
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { formatApiError } from "@/lib/errors";
import { groupNameSchema } from "@budget/shared";
import { Link, useRouter } from "expo-router";
import { Coins, HandCoins, UsersRound } from "lucide-react-native";
import { useState } from "react";
import { CreateGroupSheet } from "../components/create-group-sheet";
import {
  CurrencySheet,
  formatCurrencyLabel,
} from "../components/currency-sheet";
import { GroupSwitcher } from "../components/group-switcher";
import { InviteSheet } from "../components/invite-sheet";
import { MemberList } from "../components/member-list";
import { PendingInvites } from "../components/pending-invites";
import {
  useGroup,
  useLeaveGroup,
  useRemoveMember,
  useRenameGroup,
  useTransferOwnership,
  type Member,
} from "../hooks/use-group";
import { outstandingBalanceRefusal } from "../lib/errors";

/**
 * What a write-off actually does, in both dialogs that offer one.
 *
 * The server does not delete the debt: it records settlements that square the
 * seat, so the balance goes to zero the same way a real repayment takes it
 * there. Saying so is the difference between "we cancelled it" and "we recorded
 * payments nobody made".
 */
const WRITE_OFF_EXPLANATION =
  "Writing it off records payments that square the balance. They show up on Payments like any other repayment, and nobody is owed anything afterwards.";

export function Group() {
  const group = useGroup();
  const rename = useRenameGroup();
  const removeMember = useRemoveMember();
  const transferOwnership = useTransferOwnership();
  const leave = useLeaveGroup();
  const router = useRouter();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");

  const [pending, setPending] = useState<Member | null>(null);
  const [pendingOwner, setPendingOwner] = useState<Member | null>(null);
  const [leaving, setLeaving] = useState(false);

  // The server's own sentence naming what the seat still owes. Set only once it
  // has refused, so a null here means "no refusal yet", not "nothing owed".
  const [outstanding, setOutstanding] = useState<string | null>(null);
  const [leaveOutstanding, setLeaveOutstanding] = useState<string | null>(null);

  const [removeError, setRemoveError] = useState<string | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const currency = group.data?.isoCurrencyCode ?? "USD";
  const canSetCurrency = group.isOwner && group.data?.currencyLocked !== true;
  const parsedName = groupNameSchema.safeParse(name);

  const closeRemove = () => {
    setPending(null);
    setOutstanding(null);
    setRemoveError(null);
  };

  const closeLeave = () => {
    setLeaving(false);
    setLeaveOutstanding(null);
    setLeaveError(null);
  };

  const closeOwner = () => {
    setPendingOwner(null);
    setOwnerError(null);
  };

  const handleRename = async () => {
    if (!parsedName.success) return;

    try {
      await rename.mutateAsync({ name: parsedName.data });
      setRenameOpen(false);
    } catch (caught) {
      console.error(caught);
    }
  };

  const handleRemove = async (writeOffBalance: boolean) => {
    if (!pending) return;

    setRemoveError(null);

    try {
      await removeMember.mutateAsync({ memberId: pending.id, writeOffBalance });

      closeRemove();
    } catch (caught) {
      const refusal = outstandingBalanceRefusal(caught);

      // Not a failure yet — they hold a balance, so the same removal is offered
      // again with the write-off attached.
      if (refusal) {
        setOutstanding(refusal);
        return;
      }

      console.error(caught);
      setRemoveError(
        formatApiError(caught, "Couldn't remove them. Try again."),
      );
    }
  };

  const handleMakeOwner = async () => {
    if (!pendingOwner) return;

    setOwnerError(null);

    try {
      await transferOwnership.mutateAsync({ toMemberId: pendingOwner.id });
      closeOwner();
    } catch (caught) {
      console.error(caught);
      setOwnerError(
        formatApiError(caught, "Couldn't hand the group over. Try again."),
      );
    }
  };

  const handleLeave = async (writeOffBalance: boolean) => {
    setLeaveError(null);

    try {
      await leave.mutateAsync({ writeOffBalance });

      closeLeave();
      // `replace`, not `push`: this screen was answering for a group the account
      // is no longer in, and the session has already fallen back to another one.
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

  return (
    <>
      <RefetchScroll
        refetch={group.refetch}
        isLoading={group.isPending}
        loading={<LoadingBlock />}
        isEmpty={group.isError}
        empty={
          <LoadError
            title="Couldn't load your group"
            onRetry={() => void group.refetch()}
          />
        }
      >
        <Section>
          <SectionHeader>
            <SectionTitle>Name</SectionTitle>
            <SectionDescription>
              {group.isOwner
                ? "Everyone in the group sees this. Tap it to change it."
                : "Only an owner can change this."}
            </SectionDescription>
          </SectionHeader>

          <SectionContent>
            <SectionItem
              onPress={
                group.isOwner
                  ? () => {
                      setName(group.data?.name ?? "");
                      rename.reset();
                      setRenameOpen(true);
                    }
                  : undefined
              }
            >
              <Icon as={UsersRound} className="text-foreground size-4" />
              <Text numberOfLines={1} className="shrink font-medium">
                {group.data?.name ?? ""}
              </Text>
              {group.isOwner ? <SectionItemContent /> : null}
            </SectionItem>
          </SectionContent>
        </Section>

        <Section>
          <SectionHeader>
            <SectionTitle>Members</SectionTitle>
            <SectionDescription>
              Anybody here can pay for an expense or take a share of one.
            </SectionDescription>
          </SectionHeader>

          <MemberList
            onRemove={(member) => {
              setOutstanding(null);
              setRemoveError(null);
              setPending(member);
            }}
            onMakeOwner={(member) => {
              setOwnerError(null);
              setPendingOwner(member);
            }}
            onInvite={() => setInviteOpen(true)}
          />
        </Section>

        <PendingInvites />

        <Section>
          <SectionHeader>
            <SectionTitle>Currency</SectionTitle>
            <SectionDescription>
              {group.data?.currencyLocked === true
                ? "Fixed now that this group has balances. Nothing converts, so a change would re-denominate what you already owe each other."
                : group.isOwner
                  ? "Every expense and repayment is in this currency. Set it before the first expense lands."
                  : "Every expense and repayment is in this currency. Only an owner can change it."}
            </SectionDescription>
          </SectionHeader>

          <SectionContent>
            <SectionItem
              // No handler at all when it cannot change: a row that opens a
              // picker whose Save is guaranteed to be refused is worse than a
              // row that reads as settled.
              onPress={canSetCurrency ? () => setCurrencyOpen(true) : undefined}
            >
              <Icon as={Coins} className="text-foreground size-4" />
              <Text className="font-medium">{currency}</Text>
              <SectionItemContent>
                {canSetCurrency ? (
                  formatCurrencyLabel(currency)
                ) : (
                  // An element, not the string: the string form draws a
                  // chevron, and this row leads nowhere.
                  <Text className="text-muted-foreground">
                    {formatCurrencyLabel(currency)}
                  </Text>
                )}
              </SectionItemContent>
            </SectionItem>
          </SectionContent>
        </Section>

        <Section>
          <SectionHeader>
            <SectionTitle>Payments</SectionTitle>
            <SectionDescription>
              Every repayment between members, including anything written off,
              and the only place to take one back.
            </SectionDescription>
          </SectionHeader>

          <SectionContent>
            {/* The card-edge flags are passed explicitly: `SectionContent`
                injects them by inspecting its children, and the Link wrapper
                hides the `SectionItem` from that check. */}
            <Link href="/payments" asChild>
              <SectionItem isFirst isLast>
                <Icon as={HandCoins} className="text-foreground size-4" />
                <Text className="font-medium">See payments</Text>
                <SectionItemContent />
              </SectionItem>
            </Link>
          </SectionContent>
        </Section>

        <GroupSwitcher onCreate={() => setCreateOpen(true)} />

        <Section>
          <SectionHeader>
            <SectionTitle>Leave</SectionTitle>
            <SectionDescription>
              Your share of past expenses stays on the ledger so the history
              still adds up — you stop seeing this group.
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
            <Text className="text-destructive">Leave this group</Text>
          </Button>
        </Section>
      </RefetchScroll>

      {/* Outside RefetchScroll, like every other dialog in the app: on iOS
          DialogOverlay wraps itself in a FullWindowOverlay. */}
      <InviteSheet open={inviteOpen} onOpenChange={setInviteOpen} />

      <CreateGroupSheet open={createOpen} onOpenChange={setCreateOpen} />

      {/* Keyed on the saved currency so reopening after a save seeds from what
          was saved rather than from the selection that produced it. */}
      <CurrencySheet
        key={currency}
        open={currencyOpen}
        onOpenChange={setCurrencyOpen}
      />

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Group name</DialogTitle>
            <DialogDescription>
              Everyone in the group sees this, and it is what the group switcher
              lists.
            </DialogDescription>
          </DialogHeader>

          <Field className="gap-1">
            <FieldLabel>Name</FieldLabel>
            <Input autoCapitalize="words" value={name} onChangeText={setName} />
          </Field>

          <ApiError
            error={rename.error}
            fallback="Couldn't rename the group. Try again."
          />

          <DialogActions
            confirmLabel="Save"
            disabled={!parsedName.success}
            isPending={rename.isPending}
            onCancel={() => setRenameOpen(false)}
            onConfirm={() => void handleRename()}
          />
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingOwner !== null}
        onOpenChange={(open) => {
          if (!open) closeOwner();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Make {pendingOwner?.displayName} the owner?
            </DialogTitle>
            <DialogDescription>
              They&apos;ll be able to invite and remove people, rename the group
              and set its currency. You become an ordinary member — which is
              what lets you leave, if that&apos;s what you&apos;re after.
            </DialogDescription>
          </DialogHeader>

          {ownerError ? (
            <Text className="text-destructive text-sm">{ownerError}</Text>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={transferOwnership.isPending}
              onPress={closeOwner}
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
          if (!open) closeLeave();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {leaveOutstanding
                ? "Write off your balance and leave?"
                : "Leave this group?"}
            </DialogTitle>
            <DialogDescription>
              {leaveOutstanding
                ? `${leaveOutstanding} ${WRITE_OFF_EXPLANATION}`
                : "You stop seeing its expenses, members and balances. Your share of past expenses stays on the ledger."}
            </DialogDescription>
          </DialogHeader>

          {leaveError ? (
            <Text className="text-destructive text-sm">{leaveError}</Text>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              disabled={leave.isPending}
              onPress={closeLeave}
            >
              <Text>Stay</Text>
            </Button>
            <Button
              variant="destructive"
              disabled={leave.isPending}
              // Re-sends the same request with the write-off attached, which is
              // the only thing the server was waiting for.
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
                ? `${outstanding} ${WRITE_OFF_EXPLANATION}`
                : "They lose access to this group. Their share of past expenses stays on the ledger."}
            </DialogDescription>
          </DialogHeader>

          {removeError ? (
            <Text className="text-destructive text-sm">{removeError}</Text>
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
              // Re-sends the same removal with the write-off attached.
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
