import { RefetchScroll } from "@/components/refetch-scroll";
import { Section, SectionContent } from "@/components/section";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { ConnectBankButton } from "@/features/plaid/components/connect-bank-button";
import { PendingInvites } from "@/features/household/components/pending-invites";
import { TransactionDayHeader } from "../components/transaction-day-header";
import { TransactionListEmpty } from "../components/transaction-list-empty";
import { TransactionRow } from "../components/transaction-row";
import { useTransactions } from "../hooks/use-transactions";

/**
 * A plain scrolling list, not a SectionList.
 *
 * Virtualization needs `getItemLayout` to behave: without it the total content
 * height is an estimate that gets revised as rows measure, which shifts the
 * scroll offset when a page appends. Pagination already bounds how much is
 * mounted here, so the estimate isn't worth its cost yet. Revisit (with
 * `getItemLayout`, or FlashList) if these lists ever get genuinely long.
 */
export function Transactions() {
  const { query, sections, loadMore } = useTransactions();

  return (
    <>
      {/* Above the scroll, not inside it: `isEmpty` swaps the children out, and
          somebody who has just been invited has nothing in this list yet. */}
      <PendingInvites />

      <RefetchScroll
        refetch={query.refetch}
        isLoading={query.isPending}
        loading={<TransactionListEmpty state="loading" />}
        isEmpty={sections.length === 0}
        empty={
          <TransactionListEmpty
            state={query.isError ? "error" : "empty"}
            onRetry={() => void query.refetch()}
            action={<ConnectBankButton />}
          />
        }
      >
        {sections.map((section) => (
          <Section key={section.date}>
            <TransactionDayHeader section={section} />
            <SectionContent>
              {section.data.map((transaction, index) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  isFirst={index === 0}
                  isLast={index === section.data.length - 1}
                />
              ))}
            </SectionContent>
          </Section>
        ))}

        {query.hasNextPage ? (
          <Button
            variant="outline"
            disabled={query.isFetchingNextPage}
            onPress={loadMore}
          >
            {query.isFetchingNextPage ? (
              <Spinner className="text-foreground" />
            ) : null}
            <Text>Load more</Text>
          </Button>
        ) : null}
      </RefetchScroll>
    </>
  );
}
