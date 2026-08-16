import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Landmark } from "lucide-react-native";
import { ConnectBankButton } from "./connect-bank-button";

export function AccountsEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon as={Landmark} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>No banks connected</EmptyTitle>
        <EmptyDescription>
          Connect a bank to start tracking your spending.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <ConnectBankButton />
      </EmptyContent>
    </Empty>
  );
}
