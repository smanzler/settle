import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";

// Bump when a step is added to `app/onboarding`.
const STEP_COUNT = 1;

/**
 * Calls `request`, then `next`, when the user presses Continue. `next` runs
 * also when `request` fails.
 *
 * @param step - Zero-based position in the onboarding flow.
 */
export function OnboardingStep({
  step,
  icon,
  title,
  description,
  request,
  next,
}: {
  step: number;
  icon: LucideIcon;
  title: string;
  description: string;
  request: () => Promise<unknown>;
  next: () => void;
}) {
  const [requesting, setRequesting] = useState(false);

  // App Store review rejects a pre-prompt that can skip the system prompt, so
  // the only action always shows it.
  const handleContinue = async () => {
    setRequesting(true);
    try {
      await request();
    } catch (err) {
      console.warn("Failed to request permission", err);
    } finally {
      next();
    }
  };

  return (
    <View className="flex-1 bg-background pt-safe pb-safe-offset-4">
      <View className="flex-1 items-center justify-center gap-4 px-8">
        <View className="mb-4 size-20 items-center justify-center rounded-3xl bg-muted">
          <Icon as={icon} className="size-9" />
        </View>
        <Text variant="h3" className="text-center">
          {title}
        </Text>
        <Text className="text-center leading-6 text-muted-foreground">
          {description}
        </Text>
      </View>
      <View className="gap-6 px-6">
        {STEP_COUNT > 1 && (
          <View className="flex-row justify-center gap-2">
            {Array.from({ length: STEP_COUNT }, (_, i) => (
              <View
                key={i}
                className={cn(
                  "h-1.5 rounded-full",
                  i === step ? "w-6 bg-primary" : "w-1.5 bg-muted",
                )}
              />
            ))}
          </View>
        )}
        <Button size="lg" onPress={handleContinue} disabled={requesting}>
          <Text className="text-base">Continue</Text>
        </Button>
      </View>
    </View>
  );
}
