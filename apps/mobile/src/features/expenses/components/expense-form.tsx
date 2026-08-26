import { ApiError } from "@/components/api-error";
import { BodyScrollView } from "@/components/ui/body-scroll-view";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import type { Member } from "@/features/group/hooks/use-group";
import { isIsoDate, todayIsoDate } from "@/lib/date";
import { parseAmountCents } from "@/lib/money";
import { fromCents, type ExpenseInput } from "@budget/shared";
import { useState } from "react";
import { KeyboardAvoidingView } from "react-native";
import { buildInitialPayer, buildPayers, PayerPicker } from "./payer-picker";
import { buildInitialSplit, buildSplit, SplitEditor } from "./split-editor";

/**
 * The body of the new-expense and edit-expense screens, which differ only in
 * what they seed it with and where they send it.
 *
 * Nothing leaves here that `expenseInputSchema` would refuse: the payers have
 * to add up to the amount and an `exact` split has to add up to it too, so Save
 * stays disabled until both do. `onSubmit` receives the input; the screen owns
 * the mutation, and hands its state back through `isPending` and `error`.
 */
export function ExpenseForm({
  members,
  currency,
  initial,
  submitLabel,
  isPending,
  error,
  onSubmit,
}: {
  /** Splittable seats only — `useGroup().members` is already that list. */
  members: Member[];
  currency: string | null;
  /** The version being revised. Absent on a new expense. */
  initial?: ExpenseInput;
  submitLabel: string;
  isPending: boolean;
  error: unknown;
  onSubmit: (input: ExpenseInput) => void;
}) {
  const [amount, setAmount] = useState(() =>
    initial ? fromCents(initial.amountCents) : "",
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [expenseDate, setExpenseDate] = useState(
    () => initial?.expenseDate ?? todayIsoDate(),
  );
  const [note, setNote] = useState(initial?.note ?? "");
  const [payer, setPayer] = useState(() =>
    buildInitialPayer({ members, payers: initial?.payers }),
  );
  const [split, setSplit] = useState(() =>
    buildInitialSplit({ members, split: initial?.split }),
  );

  const parsed = parseAmountCents(amount);
  // An expense has to move money, so a zero is as unusable as a half-typed
  // number — both read as "no amount yet" and leave Save disabled.
  const amountCents = parsed !== null && parsed > 0 ? parsed : null;

  const payers = buildPayers(payer, amountCents);
  const splitInput = buildSplit(split, amountCents);
  const trimmed = description.trim();
  const isDateValid = isIsoDate(expenseDate);

  const input: ExpenseInput | null =
    amountCents !== null &&
    payers &&
    splitInput &&
    trimmed !== "" &&
    isDateValid
      ? {
          amountCents,
          description: trimmed,
          expenseDate,
          note: note.trim() === "" ? null : note.trim(),
          payers,
          split: splitInput,
        }
      : null;

  const handleSubmit = () => {
    if (input) onSubmit(input);
  };

  return (
    <KeyboardAvoidingView className="flex-1">
      {/* Without `handled`, the first tap on a member row or on Save while an
          amount box has focus is eaten dismissing the keyboard — which is every
          tap that matters here. */}
      <BodyScrollView keyboardShouldPersistTaps="handled">
        <FieldGroup className="gap-4">
          <Field className="gap-1">
            <FieldLabel>Amount</FieldLabel>
            <Input
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              selectTextOnFocus
              aria-invalid={amount.trim() !== "" && amountCents === null}
            />
            {amount.trim() !== "" && amountCents === null ? (
              <FieldError>Enter an amount like 12.34.</FieldError>
            ) : null}
          </Field>

          <Field className="gap-1">
            <FieldLabel>Description</FieldLabel>
            <Input
              value={description}
              onChangeText={setDescription}
              autoCapitalize="sentences"
              maxLength={120}
              placeholder="Groceries"
            />
          </Field>

          <Field className="gap-1">
            <FieldLabel>Date</FieldLabel>
            <Input
              value={expenseDate}
              onChangeText={setExpenseDate}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {isDateValid ? null : (
              <FieldError>Use a date like {todayIsoDate()}.</FieldError>
            )}
          </Field>

          <Field className="gap-1">
            <FieldLabel>Note (optional)</FieldLabel>
            <Textarea
              value={note}
              onChangeText={setNote}
              maxLength={500}
              placeholder="Anything the others should know"
            />
          </Field>
        </FieldGroup>

        <PayerPicker
          members={members}
          currency={currency}
          amountCents={amountCents}
          value={payer}
          onChange={setPayer}
        />

        <SplitEditor
          members={members}
          currency={currency}
          amountCents={amountCents}
          value={split}
          onChange={setSplit}
        />

        <ApiError
          error={error}
          fallback="Couldn't save the expense. Please try again."
        />

        <Button disabled={input === null || isPending} onPress={handleSubmit}>
          {isPending ? <Spinner className="text-primary-foreground" /> : null}
          <Text>{submitLabel}</Text>
        </Button>
      </BodyScrollView>
    </KeyboardAvoidingView>
  );
}
