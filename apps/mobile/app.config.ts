import type { ConfigContext, ExpoConfig } from "expo/config";
import "dotenv/config";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "settle",
  slug: "settle",
  version: "1.0.0",
  owner: "sigh10",
  orientation: "portrait",
  icon: "../../packages/shared/assets/images/icon.png",
  scheme: "com.sigh10.settle",
  userInterfaceStyle: "automatic",
  platforms: ["ios", "android"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.sigh10.settle",
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#FCFCFB",
      foregroundImage:
        "../../packages/shared/assets/images/android-icon-foreground.png",
      backgroundImage:
        "../../packages/shared/assets/images/android-icon-background.png",
      monochromeImage:
        "../../packages/shared/assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
    package: "com.sigh10.settle",
    // Android push delivery needs an FCM config: add google-services.json here
    // and re-enable this line.
    // googleServicesFile: "./google-services.json",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "../../packages/shared/assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
        dark: {
          backgroundColor: "#000000",
        },
      },
    ],
    "expo-notifications",
    "expo-build-properties",
    "expo-font",
    "expo-web-browser",
    "expo-image",
    [
      "expo-image-picker",
      {
        photosPermission:
          "Allow $(PRODUCT_NAME) to use your photos to set your profile picture.",
      },
    ],
    "expo-secure-store",
    "expo-sqlite",
    "expo-status-bar",
    "./plugins/withReleaseSigning",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    router: {},
    // Set by `eas init` — required for push tokens and EAS builds/updates.
    eas: {},
  },
});
