import {
  Section,
  SectionContent,
  SectionHeader,
  SectionTitle,
} from "@/components/section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { fromCents, sumAmounts, type Payer } from "@budget/shared";
import type { Member } from "@/features/group/hooks/use-group";
import { RemainingAmount, toAmountParts } from "./split-editor";
import { SplitMemberRow, type MemberAmount } from "./split-member-row";

/**
 * Who fronted the money, as the picker holds it.
 *
 * One payer is the common case and needs no amount at all — they put in the
 * whole thing. Several payers each need their own box, which is text until it
 * is a number, the same way the split editor holds its amounts.
 */
export type PayerState =
  | { mode: "single"; memberId: string }
  | { mode: "several"; amounts: Record<string, string> };

/** You, since you are nearly always the one who paid. */
const defaultPayerId = (members: Member[]): string =>
  members.find((member) => member.isYou)?.id ?? members[0]?.id ?? "";

/**
 * What the boxes hold, as cents, or `null` while one of them holds no number.
 * A zero is dropped rather than sent: the API takes the people who put money
 * in, and "0.00" says this one did not.
 */
const toPayerParts = (amounts: Record<string, string>): Payer[] | null =>
  toAmountParts(amounts)?.filter((payer) => payer.amountCents > 0) ?? null;

/**
 * The payers as `expenses.create` takes them, or `null` while what is on screen
 * cannot be sent.
 *
 * The total is `expenseInputSchema`'s own rule, checked here so that the form
 * cannot send what the server would only refuse.
 */
export const buildPayers = (
  state: PayerState,
  amountCents: number | null,
): Payer[] | null => {
  if (amountCents === null) return null;

  if (state.mode === "single") {
    return state.memberId === ""
      ? null
      : [{ amountCents, memberId: state.memberId }];
  }

  const payers = toPayerParts(state.amounts);
  if (!payers || payers.length === 0) return null;

  return sumAmounts(payers) === amountCents ? payers : null;
};

/**
 * What the picker opens on: the expense's own payers, or you paying all of it.
 *
 * A payer whose seat has since been removed is dropped, for the reason
 * `buildInitialSplit` drops a share — there is no row to show it in. Anything
 * dropped opens the several-payer editor even where one payer is left, because
 * single mode puts the *whole* amount on that one person: what the retired seat
 * put in has to show up as a remainder for somebody to reassign, not move onto
 * whoever is left without a word.
 */
export const buildInitialPayer = ({
  members,
  payers,
}: {
  members: Member[];
  payers?: Payer[];
}): PayerState => {
  if (!payers) return { memberId: defaultPayerId(members), mode: "single" };

  const known = payers.filter((payer) =>
    members.some((member) => member.id === payer.memberId),
  );
  const [first] = known;

  if (known.length === payers.length && known.length === 1 && first) {
    return { memberId: first.memberId, mode: "single" };
  }

  return {
    amounts: Object.fromEntries(
      known.map((payer) => [payer.memberId, fromCents(payer.amountCents)]),
    ),
    mode: "several",
  };
};

/** Who paid for this expense, and how much of it each of them put in. */
export function PayerPicker({
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
  value: PayerState;
  onChange: (state: PayerState) => void;
}) {
  const entered = value.mode === "several" ? toPayerParts(value.amounts) : null;
  const remaining =
    entered && amountCents !== null ? amountCents - sumAmounts(entered) : null;

  const toggleMode = (): PayerState => {
    if (value.mode === "single") {
      // Seeded with the whole amount on whoever was chosen, so the picker opens
      // balanced and one box is all there is to edit.
      return {
        amounts: {
          [value.memberId]: amountCents === null ? "" : fromCents(amountCents),
        },
        mode: "several",
      };
    }

    // Whoever put the most in: going back to one payer hands them all of it,
    // and the biggest is the smallest change to make.
    const [biggest] = [...(entered ?? [])].sort(
      (a, b) => b.amountCents - a.amountCents,
    );

    return {
      memberId: biggest?.memberId ?? defaultPayerId(members),
      mode: "single",
    };
  };

  const amountFor = (memberId: string): MemberAmount => {
    if (value.mode === "several") {
      return {
        kind: "money",
        noun: "paid",
        onChangeText: (draft) =>
          onChange({
            amounts: { ...value.amounts, [memberId]: draft },
            mode: "several",
          }),
        value: value.amounts[memberId] ?? "",
      };
    }

    return value.memberId === memberId
      ? { cents: amountCents, kind: "share" }
      : { kind: "none" };
  };

  return (
    <Section>
      <SectionHeader className="flex-row items-center justify-between">
        <SectionTitle>Paid by</SectionTitle>

        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onPress={() => onChange(toggleMode())}
        >
          <Text className="text-muted-foreground text-xs">
            {value.mode === "single" ? "Several people" : "One person"}
          </Text>
        </Button>
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
            // No toggle with several payers: what they put in says who paid.
            toggle={
              value.mode === "single"
                ? {
                    checked: value.memberId === member.id,
                    kind: "radio",
                    onPress: () =>
                      onChange({ memberId: member.id, mode: "single" }),
                  }
                : undefined
            }
            isFirst={index === 0}
            isLast={index === members.length - 1}
          />
        ))}
      </SectionContent>

      {value.mode === "several" ? (
        <RemainingAmount cents={remaining} currency={currency} />
      ) : null}
    </Section>
  );
}
