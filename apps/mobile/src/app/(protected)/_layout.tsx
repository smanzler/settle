import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { usePushNotificationRegistration } from "@/features/notifications/hooks/use-push-notification-registration";
import { Link, Stack } from "expo-router";
import { Plus, Scale, Users } from "lucide-react-native";
import { View } from "react-native";

export default function Layout() {
  usePushNotificationRegistration();

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "Expenses",
          // A View, not a fragment: the header slot lays out a single child, so
          // three bare buttons would stack instead of sitting side by side.
          // Spacing comes from each button's own square box — `size="icon"`
          // centers the glyph in a fixed 40pt tap target — not from a gap.
          headerRight: () => (
            <View className="flex-row items-center">
              <Link href="/balances" asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  accessibilityLabel="Balances"
                >
                  <Icon as={Scale} />
                </Button>
              </Link>
              <Link href="/group" asChild>
                <Button variant="ghost" size="icon" accessibilityLabel="Group">
                  <Icon as={Users} />
                </Button>
              </Link>
              <Link href="/expense/new" asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  accessibilityLabel="Add expense"
                >
                  <Icon as={Plus} />
                </Button>
              </Link>
            </View>
          ),
        }}
      />
      <Stack.Screen name="balances" options={{ title: "Balances" }} />
      <Stack.Screen name="payments" options={{ title: "Payments" }} />
      <Stack.Screen name="group" options={{ title: "Group" }} />
      <Stack.Screen
        name="expense/new"
        options={{ title: "New expense", presentation: "modal" }}
      />
      <Stack.Screen
        name="expense/[id]/index"
        options={{ title: "Expense", presentation: "modal" }}
      />
      <Stack.Screen
        name="expense/[id]/edit"
        options={{ title: "Edit expense", presentation: "modal" }}
      />
      <Stack.Screen name="join/index" options={{ title: "Join" }} />
      <Stack.Screen name="join/[code]" options={{ title: "Join" }} />
    </Stack>
  );
}
