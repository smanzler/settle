import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import type { PlaidItem } from "../lib/format";

type Status = PlaidItem["status"];

const LABELS: Record<
  Status,
  { text: string; variant: "secondary" | "destructive" }
> = {
  syncing: { text: "Syncing", variant: "secondary" },
  active: { text: "Connected", variant: "secondary" },
  login_required: { text: "Reconnect needed", variant: "destructive" },
  error: { text: "Error", variant: "destructive" },
  // Not destructive: disconnecting is something the user chose, and the
  // history and balances it produced are all still there.
  disconnected: { text: "Disconnected", variant: "secondary" },
};

export function ItemStatusBadge({ status }: { status: Status }) {
  const { text, variant } = LABELS[status];

  return (
    <Badge variant={variant}>
      <Text>{text}</Text>
    </Badge>
  );
}
