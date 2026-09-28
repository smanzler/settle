import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const requestPushPermission = async () => {
  // Android 13+ shows the permission prompt only after a channel exists.
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status;
};
