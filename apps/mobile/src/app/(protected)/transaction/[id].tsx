import { TransactionDetail } from "@/features/splits/screens/transaction-detail";
import { useLocalSearchParams } from "expo-router";

export default function TransactionDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return <TransactionDetail transactionId={id} />;
}
