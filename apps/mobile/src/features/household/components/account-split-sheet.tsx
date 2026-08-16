import { ApiError } from "@/components/api-error";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupOption } from "@/components/ui/radio-group";
import { Text } from "@/components/ui/text";
import type { BankAccount } from "@/features/plaid/lib/format";
import { View } from "react-native";
import { useState } from "react";
import {
  useHousehold,
  useSetAccountOwner,
  useUpdateAccount,
} from "../hooks/use-household";
import { formatIsoDate, todayIsoDate } from "../lib/format";

/**
 * Who an account belongs to, who can see it, and how new transactions on it
 * are split.
 *
 * Mount this keyed on the account id: every field seeds from `account`, and a
 * remount is what resets them when a different row is opened.
 */
export function AccountSplitSheet({
  account,
  open,
  onOpenChange,
}: {
  account: BankAccount | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { members, you, isOwner } = useHousehold();
  const setAccountOwner = useSetAccountOwner();
  const updateAccount = useUpdateAccount();

  const [ownerMemberId, setOwnerMemberId] = useState(
    account?.ownerMemberId ?? "",
  );
  const [visibility, setVisibility] = useState(
    account?.isPrivate ? "private" : "shared",
  );
  const [split, setSplit] = useState<string>(account?.defaultSplit ?? "owner");

  if (!account) return null;

  // Only an account that is *already* splitting keeps its floor. Turning
  // splitting on starts it today, whatever date is left on the row from an
  // earlier stretch of it — reusing that would silently backdate the switch by
  // however long ago it was last on. Sent explicitly rather than left to the
  // server's own default, which is its UTC today: the wrong day here, for part
  // of every day, is the difference between splitting a purchase and not.
  const splitFrom =
    account.defaultSplit === "equal"
      ? (account.defaultSplitFrom ?? todayIsoDate())
      : todayIsoDate();

  const getOwnerName = (memberId: string) =>
    members.find((member) => member.id === memberId)?.displayName ??
    "a former member";

  const isPrivate = visibility === "private";
  // Publishing someone else's private account is a disclosure, so the API only
  // lets the account's own owner change this. Read-only here rather than a
  // refusal after they've tapped Save.
  const canSetVisibility = isOwner || account.ownerMemberId === you?.id;
  const isPending = setAccountOwner.isPending || updateAccount.isPending;
  const error = setAccountOwner.error ?? updateAccount.error;

  const isDirty =
    ownerMemberId !== account.ownerMemberId ||
    isPrivate !== account.isPrivate ||
    split !== account.defaultSplit;

  const handleSave = async () => {
    const privacyChanged = isPrivate !== account.isPrivate;
    const splitChanged = split !== account.defaultSplit;
    const nextSplit = split === "equal" ? "equal" : "owner";

    try {
      if (ownerMemberId !== account.ownerMemberId) {
        await setAccountOwner.mutateAsync({
          bankAccountId: account.id,
          memberId: ownerMemberId,
        });
      }

      if (privacyChanged || splitChanged) {
        await updateAccount.mutateAsync({
          bankAccountId: account.id,
          // Only the fields that actually changed. `isPrivate` is not free to
          // resend: it rewrites `is_private` on every transaction in the
          // account, and it narrows the whole update to the account's own
          // owner — so carrying it along would refuse a housemate's split
          // change with "only the account's owner can change who sees it".
          ...(privacyChanged ? { isPrivate } : {}),
          ...(splitChanged
            ? {
                defaultSplit: nextSplit,
                ...(nextSplit === "equal"
                  ? { defaultSplitFrom: splitFrom }
                  : {}),
              }
            : {}),
        });
      }

      onOpenChange(false);
    } catch (caught) {
      console.error(caught);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{account.name}</DialogTitle>
          <DialogDescription>
            Who this account belongs to, and what happens to new transactions on
            it.
          </DialogDescription>
        </DialogHeader>

        <View className="gap-2">
          <Text className="text-sm font-medium">Owner</Text>
          {isOwner ? (
            <RadioGroup value={ownerMemberId} onValueChange={setOwnerMemberId}>
              {members.map((member) => (
                <RadioGroupOption
                  key={member.id}
                  value={member.id}
                  title={member.displayName}
                  description="Gets paid back for everything on this account."
                  onSelect={() => setOwnerMemberId(member.id)}
                />
              ))}
            </RadioGroup>
          ) : (
            <Text className="text-muted-foreground text-xs">
              {getOwnerName(account.ownerMemberId)} — only the household owner
              can change this.
            </Text>
          )}
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium">Visibility</Text>
          {canSetVisibility ? (
            <RadioGroup value={visibility} onValueChange={setVisibility}>
              <RadioGroupOption
                value="shared"
                title="Shared"
                description="Everyone in the household sees these transactions."
                onSelect={() => setVisibility("shared")}
              />
              <RadioGroupOption
                value="private"
                title="Private"
                description={`Only ${getOwnerName(ownerMemberId)} sees these transactions, and nothing on the account is split.`}
                onSelect={() => setVisibility("private")}
              />
            </RadioGroup>
          ) : (
            <Text className="text-muted-foreground text-xs">
              {isPrivate ? "Private" : "Shared"} — only{" "}
              {getOwnerName(account.ownerMemberId)} can change who sees this
              account.
            </Text>
          )}
        </View>

        <View className="gap-2">
          <Text className="text-sm font-medium">New transactions</Text>
          <RadioGroup value={split} onValueChange={setSplit}>
            <RadioGroupOption
              value="owner"
              title={`Only ${getOwnerName(ownerMemberId)}`}
              description="Nothing on this account is split unless you split it yourself."
              onSelect={() => setSplit("owner")}
            />
            <RadioGroupOption
              value="equal"
              title={`Split equally from ${formatIsoDate(splitFrom)}`}
              description={`Only transactions dated ${formatIsoDate(splitFrom)} or later are split. Everything before that stays exactly as it is — turning this on can never invent debt for months you have already settled.`}
              onSelect={() => setSplit("equal")}
            />
          </RadioGroup>
        </View>

        <ApiError error={error} fallback="Couldn't save. Please try again." />

        <DialogActions
          confirmLabel="Save"
          disabled={!isDirty}
          isPending={isPending}
          onCancel={() => onOpenChange(false)}
          onConfirm={() => void handleSave()}
        />
      </DialogContent>
    </Dialog>
  );
}
