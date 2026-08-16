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
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { TriangleAlert } from "lucide-react-native";
import { View } from "react-native";

/** The one "still in flight" filler, sized to sit in a screen's body. */
export function LoadingBlock() {
  return (
    <View className="flex-1 items-center justify-center">
      <Spinner className="text-muted-foreground size-6" />
    </View>
  );
}

/**
 * The one failed-query state.
 *
 * `title` names what failed. The description defaults to the connection
 * sentence because from the user's side that is what almost every one of these
 * is — pass a server message only where it says something they can act on.
 */
export function LoadError({
  title,
  description = "Check your connection and try again.",
  onRetry,
}: {
  title: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon as={TriangleAlert} className="text-muted-foreground" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {onRetry ? (
        <EmptyContent>
          <Button variant="outline" onPress={onRetry}>
            <Text>Try again</Text>
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}
