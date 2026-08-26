import { ApiError } from "@/components/api-error";
import { LoadError, LoadingBlock } from "@/components/query-state";
import { useGroup } from "@/features/group/hooks/use-group";
import { RefetchScroll } from "@/components/refetch-scroll";
import { Section, SectionHeader, SectionTitle } from "@/components/section";
import { Badge } from "@/components/ui/badge";
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
import { formatIsoDate } from "@/lib/date";
import { formatApiError } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { ExpenseHistory } from "../components/expense-history";
import { SliceList } from "../components/slice-list";
import { useDeleteExpense, useExpense } from "../hooks/use-expense";

/** "you" reads as a name inside a sentence; a row says "You" on its own. */
const formatActor = (member: { displayName: string; isYou: boolean }) =>
  member.isYou ? "you" : member.displayName;

/**
 * One expense in full: the money, the two sides of it, and who touched it.
 *
 * A deleted expense still opens — the history is the point of the append-only
 * ledger — but it opens read-only, with nothing to edit or delete twice.
 */
export function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useExpense(id);
  const { currency } = useGroup();
  const deleteExpense = useDeleteExpense();
  const router = useRouter();

  const [isConfirming, setIsConfirming] = useState(false);

  const closeConfirm = () => {
    setIsConfirming(false);
    // Drops a refused attempt with the dialog, so opening it again does not
    // greet the user with the last failure.
    deleteExpense.reset();
  };

  const handleDelete = () => {
    deleteExpense.mutate(
      { expenseId: id },
      {
        // The list underneath has already been invalidated by the hook, so
        // going back lands on a list this expense has left.
        onSuccess: () => {
          closeConfirm();
          router.back();
        },
      },
    );
  };

  if (query.isError) {
    return (
      <RefetchScroll
        refetch={query.refetch}
        isEmpty
        empty={
          <LoadError
            title="Couldn't load this expense"
            // The server's own sentence where it has one — "Expense not found"
            // is worth reading, a dropped connection is not.
            description={formatApiError(
              query.error,
              "Check your connection and try again.",
            )}
            onRetry={() => void query.refetch()}
          />
        }
      />
    );
  }

  const expense = query.data;

  if (!expense) {
    return (
      <RefetchScroll
        refetch={query.refetch}
        isLoading
        loading={<LoadingBlock />}
      />
    );
  }

  const isDeleted = expense.deletedAt !== null;

  return (
    <>
      <RefetchScroll refetch={query.refetch}>
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Text numberOfLines={2} className="shrink text-xl font-semibold">
              {expense.description}
            </Text>
            {isDeleted ? (
              <Badge variant="secondary">
                <Text>Deleted</Text>
              </Badge>
            ) : null}
          </View>

          <Text className="text-3xl font-semibold tabular-nums">
            {formatCents(expense.amountCents, currency)}
          </Text>

          <Text className="text-muted-foreground text-sm">
            {formatIsoDate(expense.expenseDate)}
          </Text>

          {expense.note ? (
            <Text className="text-muted-foreground text-sm">
              {expense.note}
            </Text>
          ) : null}
        </View>

        <Section>
          <SectionHeader>
            <SectionTitle>Paid by</SectionTitle>
          </SectionHeader>
          <SliceList slices={expense.payers} currency={currency} />
        </Section>

        <Section>
          <SectionHeader>
            <SectionTitle>Who owes</SectionTitle>
          </SectionHeader>
          <SliceList slices={expense.shares} currency={currency} />
        </Section>

        {/* Version 1 has no history worth opening — it is this screen. */}
        {expense.version > 1 ? (
          <ExpenseHistory expenseId={id} currency={currency} />
        ) : null}

        <View className="gap-0.5">
          <Text className="text-muted-foreground text-xs">
            Added by {formatActor(expense.createdBy)}
          </Text>
          {expense.version > 1 ? (
            <Text className="text-muted-foreground text-xs">
              Edited by {formatActor(expense.revisedBy)}
            </Text>
          ) : null}
        </View>

        {isDeleted ? (
          <Text className="text-muted-foreground text-sm">
            This expense was deleted, and everything it moved between you has
            been put back.
          </Text>
        ) : (
          <View className="gap-2">
            <Link href={`/expense/${id}/edit`} asChild>
              <Button variant="outline">
                <Text>Edit</Text>
              </Button>
            </Link>

            <Button variant="ghost" onPress={() => setIsConfirming(true)}>
              <Text className="text-destructive">Delete</Text>
            </Button>
          </View>
        )}
      </RefetchScroll>

      {/* Outside RefetchScroll, like every other dialog in the app: on iOS
          DialogOverlay wraps itself in a FullWindowOverlay. */}
      <Dialog
        open={isConfirming}
        onOpenChange={(open) => {
          if (!open) closeConfirm();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this expense?</DialogTitle>
            <DialogDescription>
              Deleting reverses every balance this expense moved, and cannot be
              undone.
            </DialogDescription>
          </DialogHeader>

          <ApiError
            error={deleteExpense.error}
            fallback="Couldn't delete this expense. Try again."
          />

          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteExpense.isPending}
              onPress={closeConfirm}
            >
              <Text>Cancel</Text>
            </Button>
            <Button
              variant="destructive"
              disabled={deleteExpense.isPending}
              onPress={handleDelete}
            >
              {deleteExpense.isPending ? (
                <Spinner className="text-white" />
              ) : null}
              <Text>Delete</Text>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
