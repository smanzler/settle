import { ApiError } from "@/components/api-error";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupOption } from "@/components/ui/radio-group";
import { isIsoDate, todayIsoDate } from "@/lib/date";
import { formatCents, parseAmountCents } from "@/lib/money";
import { fromCents } from "@budget/shared";
import { useState } from "react";
import { View } from "react-native";
import { useRecordSettlement } from "../hooks/use-settlements";
import { newSettlementId } from "../lib/settlement-id";

/** Somebody you can pay. Never you — you cannot settle up with yourself. */
export type Payee = { id: string; displayName: string };

/** A suggested transfer, carried in whole so the sheet needs no lookup. */
export type SettlePrefill = {
  amountCents: number;
  displayName: string;
  memberId: string;
};

/**
 * Records a payment you already made outside the app.
 *
 * Open it with `prefill` from a suggested transfer to seat the payee and the
 * amount, or with `null` to record something the settle-up list did not
 * suggest. Reopening always starts a fresh payment.
 */
export function SettleUpSheet({
  currency,
  onOpenChange,
  open,
  payees,
  prefill,
}: {
  currency: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payees: readonly Payee[];
  prefill: SettlePrefill | null;
}) {
  const record = useRecordSettlement();

  // ONE id per opening of the sheet. It is the idempotency key
  // `settlements.create` dedupes on, so a double tap — or a retry of a request
  // that succeeded — sends the same id and records no second payment. It lives
  // in state, not in the render body, because minting one per render defeats
  // that; `handleOpenChange` makes a new id when the sheet closes.
  const [settlementId, setSettlementId] = useState(newSettlementId);

  // `null` in these two means "still showing what the sheet opened with". The
  // prefill arrives with the settle-up query and changes after a payment, so it
  // cannot be a one-shot useState initial value.
  const [toMemberId, setToMemberId] = useState<string | null>(null);
  const [amount, setAmount] = useState<string | null>(null);
  const [settledOn, setSettledOn] = useState(todayIsoDate);
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");

  const onlyPayee = payees.length === 1 ? payees[0] : undefined;
  const payeeId = toMemberId ?? prefill?.memberId ?? onlyPayee?.id ?? null;
  const payeeName =
    prefill?.displayName ??
    payees.find((payee) => payee.id === payeeId)?.displayName;

  const amountText = amount ?? (prefill ? fromCents(prefill.amountCents) : "");
  const parsed = parseAmountCents(amountText);
  // A repayment has to actually move money, so zero is as unusable here as a
  // half-typed number — both leave the button disabled rather than sending
  // something the API would only reject.
  const amountCents = parsed !== null && parsed > 0 ? parsed : null;

  const today = todayIsoDate();
  // ISO dates compare correctly as strings, which is the whole future test.
  const dateIsValid = isIsoDate(settledOn) && settledOn <= today;

  // Only where the sheet was opened without one. A prefilled payee is named in
  // the title instead, which keeps the common path to three fields.
  const showPicker = !prefill && payees.length > 1;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSettlementId(newSettlementId());
      setToMemberId(null);
      setAmount(null);
      setSettledOn(todayIsoDate());
      setMethod("");
      setNote("");
      record.reset();
    }

    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (payeeId === null || amountCents === null || !dateIsValid) return;

    try {
      await record.mutateAsync({
        amountCents,
        // Empty is absent, not an empty string: both columns are nullable and
        // a blank method would render as a stray separator on the row.
        method: method.trim() || null,
        note: note.trim() || null,
        settledOn,
        settlementId,
        toMemberId: payeeId,
      });
      handleOpenChange(false);
    } catch (caught) {
      console.error(caught);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {payeeName ? `Pay ${payeeName}` : "Record a payment"}
          </DialogTitle>
          <DialogDescription>
            This records money you already paid. It doesn&apos;t move any.
          </DialogDescription>
        </DialogHeader>

        <View className="gap-4">
          {showPicker ? (
            <Field>
              <FieldLabel>Who you paid</FieldLabel>
              <RadioGroup value={payeeId ?? ""} onValueChange={setToMemberId}>
                {payees.map((payee) => (
                  <RadioGroupOption
                    key={payee.id}
                    value={payee.id}
                    title={payee.displayName}
                    onSelect={() => setToMemberId(payee.id)}
                  />
                ))}
              </RadioGroup>
            </Field>
          ) : null}

          <Field>
            <FieldLabel>Amount</FieldLabel>
            <Input
              value={amountText}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              selectTextOnFocus
            />
            {prefill ? (
              <FieldDescription>
                The suggested payment is{" "}
                {formatCents(prefill.amountCents, currency)}. A different amount
                is fine — it moves the balance by what you actually paid.
              </FieldDescription>
            ) : null}
            {/* Gated on `amount`, so a sheet opened with an empty field does
                not greet the user with an error they have not caused yet. */}
            {amount !== null && amountCents === null ? (
              <FieldError>Enter an amount like 12.34.</FieldError>
            ) : null}
          </Field>

          <Field>
            <FieldLabel>Date paid</FieldLabel>
            <Input
              value={settledOn}
              onChangeText={setSettledOn}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {dateIsValid ? null : (
              <FieldError>
                Use a date like {today}. A payment can&apos;t be dated in the
                future.
              </FieldError>
            )}
          </Field>

          <Field>
            <FieldLabel>Method</FieldLabel>
            <Input
              value={method}
              onChangeText={setMethod}
              placeholder="cash, venmo, bank transfer"
              autoCapitalize="none"
              maxLength={40}
            />
          </Field>

          <Field>
            <FieldLabel>Note</FieldLabel>
            <Input
              value={note}
              onChangeText={setNote}
              placeholder="Optional"
              maxLength={500}
            />
          </Field>
        </View>

        <ApiError
          error={record.error}
          fallback="Couldn't record the payment. Please try again."
        />

        <DialogActions
          confirmLabel="Record payment"
          disabled={payeeId === null || amountCents === null || !dateIsValid}
          isPending={record.isPending}
          onCancel={() => handleOpenChange(false)}
          onConfirm={() => void handleSubmit()}
        />
      </DialogContent>
    </Dialog>
  );
}
