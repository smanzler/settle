import { ApiError } from "@/components/api-error";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { currencySchema, groupNameSchema } from "@budget/shared";
import { useState } from "react";
import { useCreateGroup } from "../hooks/use-group";

/**
 * Starts a second group — a trip, a flat, a different set of people.
 *
 * The app switches into whatever this creates, so the sheet closes onto a screen
 * that has already dropped every answer it held for the group left behind. See
 * `useSetActiveGroup` for why that is a cache clear and not an invalidation.
 */
export function CreateGroupSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createGroup = useCreateGroup();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");

  const parsed = groupNameSchema.safeParse(name);
  const parsedCurrency = currencySchema.safeParse(currency);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      createGroup.reset();
      setName("");
      setCurrency("USD");
    }

    onOpenChange(next);
  };

  const handleCreate = async () => {
    if (!parsed.success || !parsedCurrency.success) return;

    try {
      await createGroup.mutateAsync({
        currency: parsedCurrency.data,
        name: parsed.data,
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
          <DialogTitle>New group</DialogTitle>
          <DialogDescription>
            Its own people, expenses and balances, kept apart from the group
            you&apos;re in now. You start as its owner and it becomes the one
            you&apos;re looking at.
          </DialogDescription>
        </DialogHeader>

        <Field className="gap-1">
          <FieldLabel>Name</FieldLabel>
          <Input
            autoCapitalize="words"
            autoFocus
            value={name}
            onChangeText={setName}
            placeholder="Lisbon trip"
          />
        </Field>

        <Field className="gap-1">
          <FieldLabel>Currency</FieldLabel>
          <Input
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={3}
            value={currency}
            onChangeText={setCurrency}
            placeholder="USD"
          />
          <FieldDescription>
            Every expense and repayment is in this. Nothing converts, so it is
            fixed once the group exists.
          </FieldDescription>
        </Field>

        <ApiError
          error={createGroup.error}
          fallback="Couldn't create the group. Try again."
        />

        <DialogActions
          confirmLabel="Create group"
          disabled={!parsed.success || !parsedCurrency.success}
          isPending={createGroup.isPending}
          onCancel={() => handleOpenChange(false)}
          onConfirm={() => void handleCreate()}
        />
      </DialogContent>
    </Dialog>
  );
}
