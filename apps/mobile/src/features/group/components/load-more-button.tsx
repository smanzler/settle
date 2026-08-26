import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";

/** The footer of a paged list. Renders nothing when there is no next page. */
export function LoadMoreButton({
  hasNextPage,
  isFetchingNextPage,
  onPress,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onPress: () => void;
}) {
  if (!hasNextPage) return null;

  return (
    <Button variant="outline" disabled={isFetchingNextPage} onPress={onPress}>
      {isFetchingNextPage ? <Spinner className="text-foreground" /> : null}
      <Text>Load more</Text>
    </Button>
  );
}
