import { formatCurrency } from "@/lib/utils";
import type { RouterOutputs } from "@/lib/trpc";

export type PlaidItem = RouterOutputs["plaid"]["items"]["list"][number];
export type BankAccount = PlaidItem["accounts"][number];

/**
 * Balances arrive as `numeric` strings and are frequently null — credit cards
 * often report no `available`. Render a dash rather than a misleading 0.
 */
const formatBalanceValue = ({
  value,
  currency,
}: {
  value: string | null;
  currency: string | null;
}): string => {
  if (value === null || value.trim() === "") return "—";

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";

  return formatCurrency(parsed, currency);
};

/**
 * On a credit account Plaid's `current` is the amount **owed**, so it needs a
 * caption — otherwise the screen implies the user is rich.
 */
export const formatAccountBalance = (account: BankAccount) => {
  const isCredit = account.type === "credit";

  return {
    text: formatBalanceValue({
      value: account.currentBalance,
      currency: account.isoCurrencyCode,
    }),
    caption: isCredit ? "Owed" : null,
  };
};

/** `Credit card · •••• 4242` — Plaid subtypes are lowercase, e.g. "credit card". */
export const formatAccountSubtitle = (account: BankAccount): string => {
  const raw = account.subtype ?? account.type;
  const kind = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "Account";

  return account.mask ? `${kind} · •••• ${account.mask}` : kind;
};

/** Today shows a clock time; anything older shows the date. */
export const formatLastSynced = (
  lastSyncedAt: string | null,
  now = new Date(),
): string => {
  if (!lastSyncedAt) return "Never synced";

  const date = new Date(lastSyncedAt);
  if (Number.isNaN(date.getTime())) return "Never synced";

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();

  return `Last synced ${
    isToday
      ? date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
        })
      : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }`;
};
