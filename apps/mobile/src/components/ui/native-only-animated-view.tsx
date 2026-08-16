import { Platform } from "react-native";
import Animated from "react-native-reanimated";

/**
 * Applies a Reanimated entrance or exit only on native, and renders the children
 * bare on web.
 *
 * @example
 * <NativeOnlyAnimatedView entering={FadeIn} exiting={FadeOut}>
 *   <Text>I am only animated on native</Text>
 * </NativeOnlyAnimatedView>
 */
function NativeOnlyAnimatedView({
  children,
  ...props
}: React.ComponentProps<typeof Animated.View> &
  React.RefAttributes<Animated.View>) {
  if (Platform.OS === "web") return <>{children}</>;

  return <Animated.View {...props}>{children}</Animated.View>;
}

export { NativeOnlyAnimatedView };
