import { LoadError, LoadingBlock } from "@/components/query-state";
import { RefetchScroll } from "@/components/refetch-scroll";
import { RefetchControl } from "@/components/ui/refetch-control";
import { Spinner } from "@/components/ui/spinner";
import { SectionList, View } from "react-native";
import { ExpenseDayHeader } from "../components/expense-day-header";
import { ExpenseListEmpty } from "../components/expense-list-empty";
import { ExpenseRow } from "../components/expense-row";
import { useGroup } from "@/features/group/hooks/use-group";
import { useExpenses } from "../hooks/use-expenses";

/**
 * The group's expenses, by day — the app's home screen.
 *
 * A SectionList rather than a plain scroll: this list grows with every night
 * out and only ever appends, which is what virtualization is for.
 *
 * The header buttons live in the route layout; this screen draws no header.
 */
export function Expenses() {
  const { loadMore, query, sections } = useExpenses();
  const { currency } = useGroup();

  // Loading, failure and emptiness are one centred block that keeps
  // pull-to-refresh — which a SectionList cannot centre on its own. A failed
  // refetch over rows already in the cache is not one of them: those rows are
  // still the last true answer, and the way to ask again is to pull on them.
  if (query.isPending || sections.length === 0) {
    return (
      <RefetchScroll
        refetch={query.refetch}
        isLoading={query.isPending}
        loading={<LoadingBlock />}
        isEmpty
        empty={
          query.isError ? (
            <LoadError
              title="Couldn't load expenses"
              onRetry={() => void query.refetch()}
            />
          ) : (
            <ExpenseListEmpty />
          )
        }
      />
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(expense) => expense.id}
      contentContainerClassName="px-4 pb-safe-offset-8"
      refreshControl={<RefetchControl refetch={query.refetch} />}
      renderSectionHeader={({ section }) => (
        <ExpenseDayHeader section={section} currency={currency} />
      )}
      renderItem={({ item, index, section }) => (
        <ExpenseRow
          expense={item}
          currency={currency}
          isFirst={index === 0}
          isLast={index === section.data.length - 1}
        />
      )}
      stickySectionHeadersEnabled
      onEndReached={loadMore}
      // Half a screen of runway: the next page has to land before the user
      // reaches the bottom, or the list stutters.
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        query.isFetchingNextPage ? (
          <View className="items-center py-4">
            <Spinner className="text-muted-foreground" />
          </View>
        ) : null
      }
    />
  );
}
