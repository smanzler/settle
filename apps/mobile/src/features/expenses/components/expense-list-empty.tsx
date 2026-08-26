import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { Link } from "expo-router";
import { Receipt } from "lucide-react-native";

/** The expenses list with nothing in it yet, and the way out of it. */
export function ExpenseListEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon as={Receipt} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No expenses yet</EmptyTitle>
        <EmptyDescription>
          Add what you paid for and the group splits it with you.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link href="/expense/new" asChild>
          <Button>
            <Text>Add an expense</Text>
          </Button>
        </Link>
      </EmptyContent>
    </Empty>
  );
}
