import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { formatApiError } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { useState } from "react";
import { View } from "react-native";
import {
  useItemImpact,
  usePurgePlaidItem,
  useRemovePlaidItem,
} from "../hooks/use-remove-plaid-item";

/**
 * The two ways to end a bank connection, which are not the same thing.
 *
 * Disconnect is soft: the credential is revoked at Plaid and dropped, and every
 * account and transaction stays. Delete is `purge`, the only irreversible action
 * in the app. This dialog used to offer disconnect while *describing* purge —
 * "its accounts and every transaction we've synced will be removed" — which is
 * the worst possible way round, since it talks people out of the safe option.
 *
 * What it can lose is stated in numbers first, from `items.impact`, because
 * nothing else in the app would tell them.
 */
export function DisconnectItemDialog({
  itemId,
  institutionName,
  open,
  onOpenChange,
}: {
  itemId: string | null;
  institutionName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useRemovePlaidItem();
  const purge = usePurgePlaidItem();
  const impact = useItemImpact(open ? itemId : null);

  // The destructive path is a second, deliberate step — never the first tap.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setConfirmingDelete(false);
    setError(null);
    onOpenChange(false);
  };

  const isPending = remove.isPending || purge.isPending;

  const run = async (action: "disconnect" | "delete") => {
    if (!itemId) return;

    setError(null);

    try {
      if (action === "disconnect") {
        await remove.mutateAsync({ itemId });
      } else {
        // The API insists on this flag rather than trusting the route it was
        // called from — the second tap in this dialog is what it stands for.
        await purge.mutateAsync({ itemId, confirm: true });
      }

      close();
    } catch (caught) {
      console.error(caught);
      setError(
        formatApiError(
          caught,
          action === "disconnect"
            ? "Couldn't disconnect. Please try again."
            : "Couldn't delete that data. Please try again.",
        ),
      );
    }
  };

  const name = institutionName ?? "this bank";
  const count = impact.data?.transactions ?? 0;
  const outstanding = impact.data?.outstanding ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {confirmingDelete
              ? `Delete ${name} and its history?`
              : `Disconnect ${name}?`}
          </DialogTitle>
          <DialogDescription>
            {confirmingDelete
              ? "This cannot be undone. The accounts and every transaction go for good. Balances stay — the ledger keeps its own copy of each amount and date — but nobody will be able to see what they were for."
              : "We stop syncing and forget the login. Your accounts and transactions stay exactly as they are, so balances still add up, and you can reconnect whenever you like."}
          </DialogDescription>
        </DialogHeader>

        {impact.isPending && itemId ? (
          <Spinner className="text-muted-foreground" />
        ) : count > 0 ? (
          <View className="gap-1">
            <Text className="text-muted-foreground text-sm">
              {count.toLocaleString()} transaction{count === 1 ? "" : "s"}{" "}
              synced from this connection.
            </Text>
            {outstanding.length > 0 ? (
              <Text className="text-muted-foreground text-sm">
                They raised{" "}
                {outstanding
                  .map((row) => formatCents(Math.abs(row.cents), row.currency))
                  .join(" + ")}{" "}
                of debt between members.
              </Text>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <Text className="text-destructive text-sm">{error}</Text>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={isPending} onPress={close}>
            <Text>Cancel</Text>
          </Button>

          {confirmingDelete ? (
            <Button
              variant="destructive"
              disabled={isPending}
              onPress={() => void run("delete")}
            >
              {purge.isPending ? <Spinner className="text-white" /> : null}
              <Text>Delete for good</Text>
            </Button>
          ) : (
            <Button
              variant="destructive"
              disabled={isPending}
              onPress={() => void run("disconnect")}
            >
              {remove.isPending ? <Spinner className="text-white" /> : null}
              <Text>Disconnect</Text>
            </Button>
          )}
        </DialogFooter>

        {/* Below the footer, deliberately understated: the safe action is the
            one with a button, and this is the door you have to go looking for. */}
        {confirmingDelete ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onPress={() => setConfirmingDelete(false)}
          >
            <Text className="text-muted-foreground text-xs">
              Actually, just disconnect it
            </Text>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onPress={() => {
              setError(null);
              setConfirmingDelete(true);
            }}
          >
            <Text className="text-muted-foreground text-xs">
              Delete its data instead
            </Text>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
