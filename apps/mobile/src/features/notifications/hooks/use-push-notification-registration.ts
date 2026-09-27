import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { useRegisterPushToken } from "./use-register-push-token";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// Onboarding asks for the permission. This hook only sends the token.
export const usePushNotificationRegistration = () => {
  const registerToken = useRegisterPushToken();

  useEffect(() => {
    (async () => {
      if (!Device.isDevice) return;

      const { status } = await Notifications.getPermissionsAsync();
      if (status !== "granted") return;

      try {
        const projectId = Constants.expoConfig?.extra?.eas?.projectId;
        const { data: token } = await Notifications.getExpoPushTokenAsync({
          projectId,
        });

        registerToken.mutate({ token });
      } catch (err) {
        console.warn("Failed to register push token", err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
