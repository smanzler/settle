import { LoadError, LoadingBlock } from "@/components/query-state";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Receipt } from "lucide-react-native";
import type { ReactNode } from "react";

export type TransactionListState = "loading" | "error" | "empty";

export function TransactionListEmpty({
  state,
  action,
  onRetry,
}: {
  state: TransactionListState;
  /** The connect CTA, injected so this file doesn't depend on Plaid. */
  action?: ReactNode;
  onRetry?: () => void;
}) {
  if (state === "loading") return <LoadingBlock />;

  if (state === "error") {
    return <LoadError title="Couldn't load transactions" onRetry={onRetry} />;
  }

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon as={Receipt} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No transactions yet</EmptyTitle>
        <EmptyDescription>
          Connect a bank to see your spending here, or pull down to refresh.
        </EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
