import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import "@/global.css";
import { authClient } from "@/lib/auth-client";
import { NAV_THEME } from "@/lib/theme";
import { ThemeProvider } from "expo-router/react-navigation";
import { PortalHost } from "@rn-primitives/portal";
import { Stack } from "expo-router";
import { TriangleAlert } from "lucide-react-native";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaListener } from "react-native-safe-area-context";
import { Uniwind, useUniwind } from "uniwind";
import { QueryProvider } from "@/providers/query-provider";
import { useOnboardingStore } from "@/features/onboarding/stores/onboarding-store";

const RootLayout = () => {
  const { theme } = useUniwind();

  return (
    <SafeAreaListener
      onChange={({ insets }) => {
        Uniwind.updateInsets(insets);
      }}
    >
      <QueryProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <ThemeProvider
            value={NAV_THEME[(theme as "light" | "dark") ?? "light"]}
          >
            <RootLayoutNav />
            <AuthOverlay />
            <PortalHost />
          </ThemeProvider>
        </GestureHandlerRootView>
      </QueryProvider>
    </SafeAreaListener>
  );
};

function RootLayoutNav() {
  const { data: session } = authClient.useSession();
  const onboarded = useOnboardingStore((state) => state.completed);

  return (
    <Stack>
      <Stack.Protected guard={!onboarded}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={onboarded && !session}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={onboarded && !!session}>
        <Stack.Screen name="(protected)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function AuthOverlay() {
  const { isPending, error } = authClient.useSession();

  if (error) {
    return (
      <View className="absolute inset-0 bg-secondary">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon as={TriangleAlert} />
            </EmptyMedia>
            <EmptyTitle>Oops</EmptyTitle>
            <EmptyDescription>
              Couldn&apos;t connect to the server
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </View>
    );
  }

  if (isPending) {
    return (
      <View className="absolute inset-0 flex-1 justify-center items-center bg-secondary">
        <Spinner />
      </View>
    );
  }

  return null;
}

export default RootLayout;
