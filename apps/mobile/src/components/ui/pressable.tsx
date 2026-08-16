import { Pressable as RNPressable, type PressableProps } from "react-native";

/**
 * A tap target with no chrome of its own — a row, an icon, or a word.
 *
 * Use `Button` for anything that must look like a control. This wrapper exists so
 * that press behaviour has one place to change, the same reason `Text` and
 * `Button` are wrapped.
 */
function Pressable(props: PressableProps) {
  return <RNPressable {...props} />;
}

export { Pressable };
export type { PressableProps };
