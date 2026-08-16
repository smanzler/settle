import { Loader2Icon, LucideProps } from "lucide-react-native";

import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import React from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

function Spinner({ className, ...props }: LucideProps) {
  const rotation = useSharedValue(0);

  React.useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, {
        duration: 1000,
        easing: Easing.linear,
      }),
      -1,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const iconClassName = cn("size-4", className);

  return (
    <Animated.View style={style} className={iconClassName}>
      <Icon
        as={Loader2Icon}
        role="status"
        aria-label="Loading"
        className={cn(iconClassName, "animate-spin")}
        {...props}
      />
    </Animated.View>
  );
}

export { Spinner };
