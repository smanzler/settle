import { cn } from "@/lib/utils";
import { Platform, ScrollViewProps } from "react-native";
import { ScrollView } from "react-native-gesture-handler";

export function BodyScrollView(props: ScrollViewProps) {
  return (
    <ScrollView
      {...props}
      automaticallyAdjustsScrollIndicatorInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName={cn(
        "m-4 gap-3",
        Platform.OS === "android" ? "pb-safe-offset-8" : "pb-4",
        props.contentContainerClassName,
      )}
    />
  );
}
