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
import { fromCents } from "@budget/shared";
import { useState } from "react";
import { View } from "react-native";
import { formatCents, parseAmountCents } from "@/lib/money";
import { useSettleUp } from "../hooks/use-settle-up";
import { newSettlementId } from "../lib/settlement-id";
import { isIsoDate, todayIsoDate } from "../lib/format";

export function SettleUpSheet({
  memberId,
  displayName,
  outstandingCents,
  currency,
  open,
  onOpenChange,
}: {
  memberId: string;
  displayName: string;
  /** What you still owe them, as a positive number. */
  outstandingCents: number;
  currency: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settle = useSettleUp();

  // ONE id per opening of the sheet. It is the idempotency key
  // `settlements.create` dedupes on, so a double tap — or a retry of a request
  // that succeeded — sends the same id and records no second payment. It lives
  // in state, not in the render body, because minting one per render defeats
  // that; `handleOpenChange` makes a new id when the sheet closes.
  const [settlementId, setSettlementId] = useState(newSettlementId);

  // `null` means "still showing the prefill". The outstanding amount arrives
  // with the balances query and changes after a payment, so it can't be a
  // one-shot useState initial value.
  const [amount, setAmount] = useState<string | null>(null);
  const [settledOn, setSettledOn] = useState(() => todayIsoDate());

  const amountText = amount ?? fromCents(outstandingCents);
  const parsed = parseAmountCents(amountText);
  // A repayment has to actually move money, so zero is as unusable here as a
  // half-typed number — both leave the button disabled rather than sending
  // something the API would only reject.
  const amountCents = parsed !== null && parsed > 0 ? parsed : null;
  const dateIsValid = isIsoDate(settledOn);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setSettlementId(newSettlementId());
      setAmount(null);
      setSettledOn(todayIsoDate());
      settle.reset();
    }

    onOpenChange(next);
  };

  const handleSubmit = async () => {
    if (amountCents === null || !dateIsValid) return;

    try {
      await settle.mutateAsync({
        settlementId,
        toMemberId: memberId,
        amountCents,
        settledOn,
      });
      handleOpenChange(false);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settle up with {displayName}</DialogTitle>
          <DialogDescription>
            This records the payment. It doesn&apos;t move any money.
          </DialogDescription>
        </DialogHeader>

        <View className="gap-4">
          <Field>
            <FieldLabel>Amount</FieldLabel>
            <Input
              value={amountText}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              selectTextOnFocus
            />
            <FieldDescription>
              You owe {displayName} {formatCents(outstandingCents, currency)}.
            </FieldDescription>
            {amountCents === null ? (
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
              <FieldError>Use a date like {todayIsoDate()}.</FieldError>
            )}
          </Field>
        </View>

        <ApiError
          error={settle.error}
          fallback="Couldn't record the payment. Please try again."
        />

        <DialogActions
          confirmLabel="Record payment"
          disabled={amountCents === null || !dateIsValid}
          isPending={settle.isPending}
          onCancel={() => handleOpenChange(false)}
          onConfirm={() => void handleSubmit()}
        />
      </DialogContent>
    </Dialog>
  );
}
