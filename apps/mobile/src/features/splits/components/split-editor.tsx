import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { formatCents, parseAmountCents } from "@/lib/money";
import type { RouterOutputs } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { allocate, equalParts, fromCents, toCents } from "@budget/shared";
import { useState } from "react";
import { View } from "react-native";
import { useResetSplit, useSetSplit } from "../hooks/use-set-split";
import { SplitMemberRow, type SplitAmount } from "./split-member-row";

type TransactionDetail = RouterOutputs["transactions"]["get"];

type Mode = "equal" | "amounts";

const MODES = [
  { value: "equal", label: "Equally" },
  { value: "amounts", label: "Amounts" },
] as const satisfies { value: Mode; label: string }[];

const initialIncluded = (detail: TransactionDetail): string[] => {
  const splittable = new Set(detail.members.map((member) => member.id));
  const included = detail.splits
    .map((split) => split.member.id)
    .filter((id) => splittable.has(id));

  // A split whose members have all been removed still has to open on something
  // the editor can render, and the payer is always somebody.
  return included.length > 0
    ? included
    : [...splittable].filter(
        (id) => id === detail.transaction.creditorMemberId,
      );
};

const initialDrafts = (detail: TransactionDetail): Record<string, string> =>
  Object.fromEntries(
    detail.splits.map((split) => [
      split.member.id,
      // Magnitudes: the sign belongs to the transaction, never to a text field.
      fromCents(Math.abs(split.amountCents)),
    ]),
  );

/**
 * Who this transaction is split between.
 *
 * Both modes preview with the shared `allocate`, so the cents on screen are the
 * cents the server writes — the odd cent on a $10.01 three-way lands on the
 * same person here and in the ledger.
 */
export function SplitEditor({ detail }: { detail: TransactionDetail }) {
  const { transaction, currency, members } = detail;

  const [mode, setMode] = useState<Mode>(
    transaction.splitMethod === "exact" ? "amounts" : "equal",
  );
  const [included, setIncluded] = useState(() => initialIncluded(detail));
  const [drafts, setDrafts] = useState(() => initialDrafts(detail));

  const setSplit = useSetSplit();
  const resetSplit = useResetSplit();
  const isBusy = setSplit.isPending || resetSplit.isPending;

  const totalCents = toCents(transaction.amount);
  const preview =
    included.length > 0 ? allocate(totalCents, equalParts(included)) : null;

  const entered = included.map((id) => parseAmountCents(drafts[id] ?? ""));
  const isValid = entered.every((cents) => cents !== null);
  const remainingCents =
    Math.abs(totalCents) -
    entered.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);

  const selectMode = (next: Mode) => {
    // Re-tapping the mode you are already in must not wipe what you typed.
    if (next === mode) return;

    if (next === "amounts") {
      // Seeded from the equal preview so the editor opens balanced: typing one
      // number and nudging another is the edit people actually make.
      setDrafts(
        Object.fromEntries(
          included.map((id) => [
            id,
            fromCents(Math.abs(preview?.get(id) ?? 0)),
          ]),
        ),
      );
    }

    setMode(next);
  };

  const toggle = (memberId: string, checked: boolean) =>
    setIncluded((current) =>
      checked
        ? [...current, memberId]
        : current.filter((id) => id !== memberId),
    );

  const amountFor = (memberId: string): SplitAmount =>
    mode === "amounts"
      ? {
          kind: "input",
          value: drafts[memberId] ?? "",
          onChangeText: (value) =>
            setDrafts((current) => ({ ...current, [memberId]: value })),
        }
      : { kind: "share", cents: preview?.get(memberId) ?? 0 };

  const handleSave = () => {
    if (mode === "equal") {
      setSplit.mutate({
        transactionId: transaction.id,
        method: "shares",
        parts: equalParts(included),
      });
      return;
    }

    setSplit.mutate({
      transactionId: transaction.id,
      method: "exact",
      parts: included.map((memberId) => ({
        memberId,
        amountCents: parseAmountCents(drafts[memberId] ?? "") ?? 0,
      })),
    });
  };

  const handleSplitWithEveryone = () => {
    const memberIds = members.map((member) => member.id);

    setMode("equal");
    setIncluded(memberIds);
    setSplit.mutate({
      transactionId: transaction.id,
      method: "shares",
      parts: equalParts(memberIds),
    });
  };

  const handlePayerOnly = () => {
    setMode("equal");
    setIncluded(
      members.some((member) => member.id === transaction.creditorMemberId)
        ? [transaction.creditorMemberId]
        : [],
    );
    resetSplit.mutate({ transactionId: transaction.id });
  };

  const canSave =
    !isBusy &&
    included.length > 0 &&
    (mode === "equal" || (isValid && remainingCents === 0));

  const payer = members.find(
    (member) => member.id === transaction.creditorMemberId,
  );

  const error = setSplit.error ?? resetSplit.error;

  return (
    <Section>
      <SectionHeader className="flex-row items-center justify-between">
        <SectionTitle>Split</SectionTitle>

        <View className="bg-muted flex-row rounded-md p-0.5">
          {MODES.map(({ value, label }) => (
            <Button
              key={value}
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 px-3",
                mode === value && "bg-background shadow-sm shadow-black/5",
              )}
              onPress={() => selectMode(value)}
            >
              <Text
                className={cn(
                  "text-xs",
                  mode !== value && "text-muted-foreground",
                )}
              >
                {label}
              </Text>
            </Button>
          ))}
        </View>
      </SectionHeader>

      <SectionContent>
        {members.map((member, index) => (
          <SplitMemberRow
            key={member.id}
            member={member}
            currency={currency}
            checked={included.includes(member.id)}
            onCheckedChange={(checked) => toggle(member.id, checked)}
            amount={amountFor(member.id)}
            isFirst={index === 0}
            isLast={index === members.length - 1}
          />
        ))}
      </SectionContent>

      {mode === "amounts" ? (
        <View className="flex-row items-center justify-between px-1">
          <Text className="text-muted-foreground text-sm">
            {remainingCents < 0 ? "Over by" : "Remaining"}
          </Text>
          <Text
            className={cn(
              "text-sm tabular-nums",
              isValid && remainingCents === 0
                ? "text-success"
                : "text-destructive",
            )}
          >
            {isValid ? formatCents(Math.abs(remainingCents), currency) : "—"}
          </Text>
        </View>
      ) : null}

      <Button disabled={!canSave} onPress={handleSave}>
        {setSplit.isPending ? (
          <Spinner className="text-primary-foreground" />
        ) : null}
        <Text>Save split</Text>
      </Button>

      {/* The two edits that cover almost every real correction, one tap each. */}
      <View className="flex-row gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={isBusy}
          onPress={handleSplitWithEveryone}
        >
          <Text>Split with everyone</Text>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={isBusy}
          onPress={handlePayerOnly}
        >
          {/* Named when somebody else paid: this button hands them the whole
              amount, and calling that "Just me" would be a lie. */}
          <Text>
            {payer && !payer.isYou ? `Just ${payer.displayName}` : "Just me"}
          </Text>
        </Button>
      </View>

      {error ? (
        <Text className="text-destructive text-sm">{error.message}</Text>
      ) : null}
    </Section>
  );
}
