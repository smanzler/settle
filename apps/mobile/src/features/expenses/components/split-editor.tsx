import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { formatCents, parseAmountCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  buildShares,
  fromCents,
  MAX_WEIGHT,
  sumAmounts,
  type AllocationPart,
  type Share,
  type Split,
} from "@budget/shared";
import { View } from "react-native";
import type { Member } from "@/features/group/hooks/use-group";
import { SplitMemberRow, type MemberAmount } from "./split-member-row";

/**
 * The split as the editor holds it — text, because a half-typed weight or
 * amount has to survive between keystrokes. `buildSplit` turns it into the
 * `Split` the API takes, and refuses while the numbers are not ones the server
 * would accept.
 */
export type SplitState =
  | { mode: "equal"; memberIds: string[] }
  | { mode: "weights"; parts: Record<string, string> }
  | { mode: "exact"; parts: Record<string, string> };

const MODES = [
  { label: "Equally", value: "equal" },
  { label: "Shares", value: "weights" },
  { label: "Amounts", value: "exact" },
] as const satisfies { label: string; value: SplitState["mode"] }[];

/** Who is in the split, in whichever shape the current mode keeps them. */
const includedIds = (state: SplitState): string[] =>
  state.mode === "equal" ? state.memberIds : Object.keys(state.parts);

const isEntered = (part: {
  amountCents: number | null;
  memberId: string;
}): part is Share => part.amountCents !== null;

/**
 * Every box in a record of typed money as cents, or `null` while one of them
 * holds no number. An empty box is zero — that is a keypad state, not a refusal.
 *
 * Shared with the payer picker, which holds its amounts the same way.
 */
export const toAmountParts = (
  parts: Record<string, string>,
): Share[] | null => {
  const entries = Object.entries(parts).map(([memberId, draft]) => ({
    amountCents: parseAmountCents(draft),
    memberId,
  }));
  const entered = entries.filter(isEntered);

  return entered.length === entries.length ? entered : null;
};

const isWeight = (part: AllocationPart) =>
  Number.isInteger(part.weight) &&
  part.weight >= 1 &&
  part.weight <= MAX_WEIGHT;

/** Every typed weight, or `null` while one of them is not one the API takes. */
const toWeightParts = (
  parts: Record<string, string>,
): AllocationPart[] | null => {
  const entries = Object.entries(parts).map(([memberId, draft]) => ({
    memberId,
    // An empty box reads as 0, which `isWeight` rejects along with "abc".
    weight: Number(draft.trim()),
  }));

  return entries.every(isWeight) ? entries : null;
};

/** A drafts record with one member set, or dropped when `draft` is null. */
const withDraft = ({
  draft,
  memberId,
  parts,
}: {
  draft: string | null;
  memberId: string;
  parts: Record<string, string>;
}): Record<string, string> =>
  draft === null
    ? Object.fromEntries(
        Object.entries(parts).filter(([id]) => id !== memberId),
      )
    : { ...parts, [memberId]: draft };

/**
 * The split as `expenses.create` takes it, or `null` while what is on screen
 * cannot be sent.
 *
 * An `exact` split stays `null` until the parts add up to the amount:
 * `buildShares` throws on one that does not, so this is also what keeps the
 * preview from taking the screen down. The form disables Save on `null` rather
 * than send the server something it would only refuse.
 */
export const buildSplit = (
  state: SplitState,
  amountCents: number | null,
): Split | null => {
  switch (state.mode) {
    case "equal":
      return state.memberIds.length > 0
        ? { memberIds: state.memberIds, mode: "equal" }
        : null;
    case "weights": {
      const parts = toWeightParts(state.parts);

      return parts && parts.length > 0 ? { mode: "weights", parts } : null;
    }
    case "exact": {
      const parts = toAmountParts(state.parts);
      if (!parts || parts.length === 0 || amountCents === null) return null;

      return sumAmounts(parts) === amountCents
        ? { mode: "exact", parts }
        : null;
    }
  }
};

/**
 * What the editor opens on: the expense's own split, or everybody, equally.
 *
 * A part whose seat has since been removed is dropped. The editor has no row to
 * show it in, and a share nobody can see must not travel into the next version
 * — what the drop leaves unassigned shows up in the remaining line.
 */
export const buildInitialSplit = ({
  members,
  split,
}: {
  members: Member[];
  split?: Split;
}): SplitState => {
  const memberIds = members.map((member) => member.id);
  if (!split) return { memberIds, mode: "equal" };

  const isKnown = (memberId: string) => memberIds.includes(memberId);

  switch (split.mode) {
    case "equal":
      return { memberIds: split.memberIds.filter(isKnown), mode: "equal" };
    case "weights":
      return {
        mode: "weights",
        parts: Object.fromEntries(
          split.parts
            .filter((part) => isKnown(part.memberId))
            .map((part) => [part.memberId, String(part.weight)]),
        ),
      };
    case "exact":
      return {
        mode: "exact",
        parts: Object.fromEntries(
          split.parts
            .filter((part) => isKnown(part.memberId))
            .map((part) => [part.memberId, fromCents(part.amountCents)]),
        ),
      };
  }
};

/**
 * What is still unassigned, in the treatment the payer editor uses as well.
 *
 * `cents` is what is left of the amount, so a negative means the parts overshoot
 * it. `null` while one of the boxes holds no number.
 */
export function RemainingAmount({
  cents,
  currency,
}: {
  cents: number | null;
  currency: string | null;
}) {
  return (
    <View className="flex-row items-center justify-between px-1">
      <Text className="text-muted-foreground text-sm">
        {cents !== null && cents < 0 ? "Over by" : "Remaining"}
      </Text>
      <Text
        className={cn(
          "text-sm tabular-nums",
          cents === 0 ? "text-success" : "text-destructive",
        )}
      >
        {cents === null ? "—" : formatCents(Math.abs(cents), currency)}
      </Text>
    </View>
  );
}

/**
 * Who this expense is split between, and how.
 *
 * Every mode previews with the shared `buildShares`, so the cents on screen are
 * the cents the server writes — the odd cent on a $10.01 three-way lands on the
 * same person here and in the ledger.
 */
export function SplitEditor({
  members,
  currency,
  amountCents,
  value,
  onChange,
}: {
  members: Member[];
  currency: string | null;
  /** `null` while the amount field holds no number. */
  amountCents: number | null;
  value: SplitState;
  onChange: (state: SplitState) => void;
}) {
  const included = includedIds(value);
  const split = buildSplit(value, amountCents);

  // Safe: `buildSplit` has already refused the one input `buildShares` throws
  // on — an `exact` split that does not add up.
  const shares =
    split && amountCents !== null
      ? new Map(
          buildShares(amountCents, split).map((share) => [
            share.memberId,
            share.amountCents,
          ]),
        )
      : null;

  const entered = value.mode === "exact" ? toAmountParts(value.parts) : null;
  const remaining =
    entered && amountCents !== null ? amountCents - sumAmounts(entered) : null;

  const toMode = (mode: SplitState["mode"]): SplitState => {
    switch (mode) {
      case "equal":
        return { memberIds: included, mode };
      case "weights":
        // All 1s is the equal split again, so this changes nothing on screen
        // until a weight is edited.
        return {
          mode,
          parts: Object.fromEntries(included.map((id) => [id, "1"])),
        };
      case "exact":
        // Seeded from the resolved preview so the editor opens balanced: typing
        // one number and nudging another is the edit people actually make.
        return {
          mode,
          parts: Object.fromEntries(
            included.map((memberId) => {
              const cents = shares?.get(memberId);

              return [memberId, cents === undefined ? "" : fromCents(cents)];
            }),
          ),
        };
    }
  };

  const selectMode = (mode: SplitState["mode"]) => {
    // Re-tapping the mode you are already in must not wipe what you typed.
    if (mode !== value.mode) onChange(toMode(mode));
  };

  const toggle = (memberId: string): SplitState => {
    const isIn = included.includes(memberId);

    switch (value.mode) {
      case "equal":
        return {
          memberIds: isIn
            ? value.memberIds.filter((id) => id !== memberId)
            : [...value.memberIds, memberId],
          mode: "equal",
        };
      case "weights":
        return {
          mode: "weights",
          parts: withDraft({
            draft: isIn ? null : "1",
            memberId,
            parts: value.parts,
          }),
        };
      case "exact":
        return {
          mode: "exact",
          // Empty rather than "0.00": the placeholder invites the number, and
          // an empty box already counts as zero in the remaining line.
          parts: withDraft({
            draft: isIn ? null : "",
            memberId,
            parts: value.parts,
          }),
        };
    }
  };

  const amountFor = (memberId: string): MemberAmount => {
    if (!included.includes(memberId)) return { kind: "none" };

    switch (value.mode) {
      case "equal":
        return { cents: shares?.get(memberId) ?? null, kind: "share" };
      case "weights":
        return {
          cents: shares?.get(memberId) ?? null,
          kind: "weight",
          onChangeText: (draft) =>
            onChange({
              mode: "weights",
              parts: withDraft({ draft, memberId, parts: value.parts }),
            }),
          value: value.parts[memberId] ?? "",
        };
      case "exact":
        return {
          kind: "money",
          noun: "share",
          onChangeText: (draft) =>
            onChange({
              mode: "exact",
              parts: withDraft({ draft, memberId, parts: value.parts }),
            }),
          value: value.parts[memberId] ?? "",
        };
    }
  };

  return (
    <Section>
      <SectionHeader className="flex-row items-center justify-between">
        <SectionTitle>Split</SectionTitle>

        <View className="bg-muted flex-row rounded-md p-0.5">
          {MODES.map(({ label, value: mode }) => (
            <Button
              key={mode}
              size="sm"
              variant="ghost"
              className={cn(
                "h-7 px-3",
                value.mode === mode && "bg-background shadow-sm shadow-black/5",
              )}
              onPress={() => selectMode(mode)}
            >
              <Text
                className={cn(
                  "text-xs",
                  value.mode !== mode && "text-muted-foreground",
                )}
              >
                {label}
              </Text>
            </Button>
          ))}
        </View>
      </SectionHeader>

      <SectionContent>
        {/* The edges are passed by hand: `SectionContent` only derives them for
            a direct `SectionItem`, and each row wraps its own. */}
        {members.map((member, index) => (
          <SplitMemberRow
            key={member.id}
            member={member}
            currency={currency}
            amount={amountFor(member.id)}
            toggle={{
              checked: included.includes(member.id),
              kind: "checkbox",
              onPress: () => onChange(toggle(member.id)),
            }}
            isFirst={index === 0}
            isLast={index === members.length - 1}
          />
        ))}
      </SectionContent>

      {value.mode === "exact" ? (
        <RemainingAmount cents={remaining} currency={currency} />
      ) : null}

      {included.length === 0 ? (
        <Text className="text-destructive text-sm">
          Choose who this is split between.
        </Text>
      ) : null}
    </Section>
  );
}
