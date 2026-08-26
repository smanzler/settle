import { LoadError, LoadingBlock } from "@/components/query-state";
import { useGroup } from "@/features/group/hooks/use-group";
import type { ExpenseInput } from "@budget/shared";
import { useRouter } from "expo-router";
import { ExpenseForm } from "../components/expense-form";
import { useSaveExpense } from "../hooks/use-save-expense";

/** Adds an expense to the group. */
export function NewExpense() {
  const router = useRouter();
  const group = useGroup();
  const { create } = useSaveExpense();

  if (group.isPending) return <LoadingBlock />;

  if (group.isError) {
    return (
      <LoadError
        title="Couldn't load the group"
        onRetry={() => void group.refetch()}
      />
    );
  }

  const handleSubmit = async (input: ExpenseInput) => {
    try {
      await create.mutateAsync(input);
      router.back();
    } catch (error) {
      // The form shows the refusal itself; this only keeps it off the console
      // as an unhandled rejection.
      console.error(error);
    }
  };

  return (
    <ExpenseForm
      members={group.members}
      currency={group.currency}
      submitLabel="Add expense"
      isPending={create.isPending}
      error={create.error}
      onSubmit={(input) => void handleSubmit(input)}
    />
  );
}
