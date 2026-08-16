import React from "react";
import { ScrollViewProps } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BodyScrollView } from "@/components/ui/body-scroll-view";
import { RefetchControl } from "@/components/ui/refetch-control";

type Props = {
  refetch?: () => Promise<unknown>;
  isEmpty?: boolean;
  empty?: React.ReactNode;
  isLoading?: boolean;
  loading?: React.ReactNode;
};

export function RefetchScroll({
  refetch,
  isEmpty,
  empty,
  isLoading,
  loading,
  ...props
}: ScrollViewProps & Props) {
  const renderBody = (bodyProps: ScrollViewProps) => (
    <BodyScrollView
      {...bodyProps}
      refreshControl={
        refetch ? <RefetchControl refetch={refetch} /> : undefined
      }
    />
  );

  const withSafe = (children: React.ReactNode) => (
    // `style`, not `className`: uniwind only patches the components it
    // re-exports from `react-native`, and a className here is dropped.
    <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
      {renderBody({ children, contentContainerClassName: "grow" })}
    </SafeAreaView>
  );

  if (isLoading) return withSafe(loading);
  if (isEmpty) return withSafe(empty);

  return renderBody(props);
}
