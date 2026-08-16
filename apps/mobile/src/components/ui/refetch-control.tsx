import { useState } from "react";
import { RefreshControl, RefreshControlProps } from "react-native";

export function RefetchControl({
  refetch,
  ...props
}: {
  refetch: () => Promise<unknown>;
} & Omit<RefreshControlProps, "refreshing">) {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  };

  return (
    <RefreshControl
      {...props}
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      title="Refresh"
    />
  );
}
