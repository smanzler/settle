import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import {
  formatAccountLabel,
  formatTransactionAmount,
} from "@/features/transactions/lib/format";
import { formatDayHeading } from "@/features/transactions/lib/group";
import { cn } from "@/lib/utils";
import { View } from "react-native";
import { SplitEditor } from "../components/split-editor";
import { useTransaction } from "../hooks/use-transaction";

export function TransactionDetail({
  transactionId,
}: {
  transactionId: string;
}) {
  const query = useTransaction(transactionId);

  if (query.isError) {
    return (
      <RefetchScroll
        refetch={query.refetch}
        isEmpty
        empty={
          // The server's own sentence, not the connection default: this screen
          // refuses for reasons the user can act on — a foreign-currency
          // transaction, an account hidden as a duplicate.
          <LoadError
            title="Couldn't load this transaction"
            description={query.error.message}
            onRetry={() => void query.refetch()}
          />
        }
      />
    );
  }

  const detail = query.data;

  if (!detail) {
    return (
      <RefetchScroll
        refetch={query.refetch}
        isLoading
        loading={<LoadingBlock />}
      />
    );
  }

  const { transaction, currency, members } = detail;
  const { text, isInflow } = formatTransactionAmount({
    amount: transaction.amount,
    currency,
  });

  const account = formatAccountLabel({
    name: transaction.accountName,
    mask: transaction.accountMask,
  });

  // Everything below this line is a household surface, and a household of one
  // must not see any of it — no payer, no editor, just the transaction.
  const isShared = members.length > 1;

  // The splits are the fallback because a removed seat can still be the payer:
  // it is gone from `members`, but its history — and its name — is not.
  const payer =
    members.find((member) => member.id === transaction.creditorMemberId) ??
    detail.splits.find(
      (split) => split.member.id === transaction.creditorMemberId,
    )?.member;

  const paidBy = payer?.isYou ? "you" : (payer?.displayName ?? "someone else");

  return (
    // Without `handled`, the first tap on Save while an amount field has focus
    // is eaten dismissing the keyboard — which is every tap that matters here.
    <RefetchScroll refetch={query.refetch} keyboardShouldPersistTaps="handled">
      <View className="gap-1">
        <Text className="text-xl font-semibold">
          {transaction.merchantName ?? transaction.name}
        </Text>

        <Text
          className={cn(
            "text-3xl font-semibold tabular-nums",
            isInflow && "text-success",
          )}
        >
          {text}
        </Text>

        <Text className="text-muted-foreground text-sm">
          {formatDayHeading(transaction.date)}
        </Text>

        <Text className="text-muted-foreground text-sm">
          {isShared ? `Paid by ${paidBy} · ${account}` : account}
        </Text>
      </View>

      {isShared && transaction.splitsStale ? (
        <View className="gap-1">
          <Badge variant="secondary" className="self-start">
            <Text>Review split</Text>
          </Badge>
          <Text className="text-muted-foreground text-xs">
            The amount changed after this split was set, so the shares below may
            no longer be what you meant.
          </Text>
        </View>
      ) : null}

      {isShared ? <SplitEditor detail={detail} /> : null}
    </RefetchScroll>
  );
}
