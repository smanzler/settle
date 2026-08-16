import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useHousehold } from "@/features/household/hooks/use-household";
import { usePushNotificationRegistration } from "@/features/notifications/hooks/use-push-notification-registration";
import { Link, Stack } from "expo-router";
import { Landmark, Users } from "lucide-react-native";
import { View } from "react-native";

export default function Layout() {
  usePushNotificationRegistration();

  // The household exists from signup, but none of it is worth showing until
  // there is someone to owe. A solo user sees exactly the header they saw
  // before this feature existed; the only way in is the verb-shaped
  // "Split with someone" row on the Accounts screen.
  //
  // Through the hook, not a raw query: `household.get` includes removed seats
  // so the ledger can name them, and counting those would keep the Balances
  // icon on a household whose second member has left.
  const { isShared } = useHousehold();

  return (
    <Stack>
      <Stack.Screen
        name="index"
        options={{
          title: "Transactions",
          // A View, not a fragment: the header slot lays out a single child, so
          // two bare buttons would stack instead of sitting side by side.
          // Spacing comes from each button's own square box — `size="icon"`
          // centers the glyph in a fixed 40pt tap target — not from a gap.
          headerRight: () => (
            <View className="flex-row items-center">
              {isShared ? (
                <Link href="/balances" asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    accessibilityLabel="Balances"
                  >
                    <Icon as={Users} />
                  </Button>
                </Link>
              ) : null}
              <Link href="/accounts" asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  accessibilityLabel="Accounts"
                >
                  <Icon as={Landmark} />
                </Button>
              </Link>
            </View>
          ),
        }}
      />
      <Stack.Screen name="accounts" options={{ title: "Accounts" }} />
      <Stack.Screen name="balances" options={{ title: "Balances" }} />
      <Stack.Screen name="payments" options={{ title: "Payments" }} />
      {/* Titled from the screen itself — it names the person you're square
          with, which the layout has no way to know here. */}
      <Stack.Screen name="balances/[memberId]" />
      <Stack.Screen name="household" options={{ title: "Household" }} />
      <Stack.Screen
        name="transaction/[id]"
        options={{ title: "Transaction", presentation: "modal" }}
      />
      <Stack.Screen name="join/[code]" options={{ title: "Join" }} />
      <Stack.Screen name="join/index" options={{ title: "Join" }} />
    </Stack>
  );
}
