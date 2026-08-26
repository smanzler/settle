import { LoadError, LoadingBlock } from "@/components/query-state";
import { useGroup } from "@/features/group/hooks/use-group";
import { useTRPC } from "@/lib/trpc";
import type { ExpenseInput } from "@budget/shared";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ExpenseForm } from "../components/expense-form";
import { useSaveExpense } from "../hooks/use-save-expense";

/**
 * Revises an expense.
 *
 * A revision states the whole expense again — the form is the same one that
 * creates it, seeded from the version on screen now.
 */
export function EditExpense() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const trpc = useTRPC();
  const router = useRouter();
  const group = useGroup();
  const expense = useQuery(trpc.expenses.get.queryOptions({ expenseId: id }));
  const { revise } = useSaveExpense();

  if (group.isPending || expense.isPending) return <LoadingBlock />;

  if (group.isError || expense.isError) {
    return (
      <LoadError
        title="Couldn't load this expense"
        onRetry={() => {
          void group.refetch();
          void expense.refetch();
        }}
      />
    );
  }

  if (expense.data.deletedAt !== null) {
    return (
      <LoadError
        title="This expense was deleted"
        description="Nothing more can be changed on it."
      />
    );
  }

  const initial: ExpenseInput = {
    amountCents: expense.data.amountCents,
    description: expense.data.description,
    expenseDate: expense.data.expenseDate,
    note: expense.data.note,
    payers: expense.data.payers.map((payer) => ({
      amountCents: payer.amountCents,
      memberId: payer.id,
    })),
    // `exact`, from the cents already stored, rather than the mode they were
    // entered in: reopening an equal split must not re-round it, and a share
    // that moved by a cent while nobody touched it is a change no one can
    // explain.
    split: {
      mode: "exact",
      parts: expense.data.shares.map((share) => ({
        amountCents: share.amountCents,
        memberId: share.id,
      })),
    },
  };

  const handleSubmit = async (input: ExpenseInput) => {
    try {
      await revise.mutateAsync({ expenseId: id, input });
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
      initial={initial}
      submitLabel="Save changes"
      isPending={revise.isPending}
      error={revise.error}
      onSubmit={(input) => void handleSubmit(input)}
    />
  );
}
