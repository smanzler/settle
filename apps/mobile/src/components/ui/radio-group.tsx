import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import * as RadioGroupPrimitive from "@rn-primitives/radio-group";
import { Platform, Pressable, View } from "react-native";

function RadioGroup({
  className,
  ...props
}: RadioGroupPrimitive.RootProps &
  React.RefAttributes<RadioGroupPrimitive.RootRef>) {
  return (
    <RadioGroupPrimitive.Root className={cn("gap-3", className)} {...props} />
  );
}

function RadioGroupItem({
  className,
  ...props
}: RadioGroupPrimitive.ItemProps &
  React.RefAttributes<RadioGroupPrimitive.ItemRef>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        "border-input dark:bg-input/30 aspect-square size-4 shrink-0 items-center justify-center rounded-full border shadow-sm shadow-black/5",
        Platform.select({
          web: "focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive outline-none transition-all focus-visible:ring-[3px] disabled:cursor-not-allowed",
        }),
        props.disabled && "opacity-50",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="bg-primary size-2 rounded-full" />
    </RadioGroupPrimitive.Item>
  );
}

/**
 * A whole radio row: the dot, a tappable label, and an optional line of
 * explanation under it.
 *
 * The primitive `RadioGroupItem` is only the dot, so every caller was otherwise
 * repeating the same Pressable-plus-Label-plus-caption scaffold — and getting the
 * fiddly part wrong is easy, because the label needs its own `onPress` (tapping
 * text does not reach the row on native) and `nativeID`/`aria-labelledby` have to
 * agree for the dot to be announced with its name.
 */
function RadioGroupOption({
  value,
  title,
  description,
  className,
  onSelect,
}: {
  value: string;
  title: string;
  description?: string;
  className?: string;
  onSelect: () => void;
}) {
  const nativeID = `radio-option-${value}`;

  return (
    <Pressable
      className={cn(
        description
          ? "flex-row items-start gap-3"
          : "flex-row items-center gap-3",
        className,
      )}
      onPress={onSelect}
    >
      <RadioGroupItem
        value={value}
        aria-labelledby={nativeID}
        className={description ? "mt-1" : undefined}
      />
      <View className="min-w-0 flex-1 gap-0.5">
        <Label nativeID={nativeID} onPress={onSelect}>
          {title}
        </Label>
        {description ? (
          <Text className="text-muted-foreground text-xs">{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export { RadioGroup, RadioGroupItem, RadioGroupOption };
