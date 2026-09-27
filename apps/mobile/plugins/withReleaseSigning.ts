import { type ConfigPlugin, withAppBuildGradle } from "expo/config-plugins";

const RELEASE_SIGNING_CONFIG = `
        if (findProperty('SETTLE_UPLOAD_STORE_FILE')) {
            release {
                storeFile file(findProperty('SETTLE_UPLOAD_STORE_FILE'))
                storePassword findProperty('SETTLE_UPLOAD_STORE_PASSWORD')
                keyAlias findProperty('SETTLE_UPLOAD_KEY_ALIAS')
                keyPassword findProperty('SETTLE_UPLOAD_KEY_PASSWORD')
            }
        }`;

const SIGNING_CONFIGS = "signingConfigs {";

const DEBUG_SIGNED_RELEASE =
  /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/;

// Play rejects an unsigned bundle; a debug-signed one could be uploaded by mistake.
const RELEASE_SIGNING = "signingConfig signingConfigs.findByName('release')";

/**
 * Signs Android release builds with the upload key named by the Gradle
 * properties `SETTLE_UPLOAD_STORE_FILE`, `SETTLE_UPLOAD_STORE_PASSWORD`,
 * `SETTLE_UPLOAD_KEY_ALIAS` and `SETTLE_UPLOAD_KEY_PASSWORD`, set in
 * `~/.gradle/gradle.properties` or as `ORG_GRADLE_PROJECT_*` env vars.
 * Without them, release builds are unsigned.
 */
const withReleaseSigning: ConfigPlugin = (config) =>
  withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;

    if (!gradle.includes(RELEASE_SIGNING_CONFIG)) {
      if (!gradle.includes(SIGNING_CONFIGS)) {
        throw new Error("withReleaseSigning: no signingConfigs block found");
      }
      gradle = gradle.replace(
        SIGNING_CONFIGS,
        SIGNING_CONFIGS + RELEASE_SIGNING_CONFIG,
      );
    }

    if (!gradle.includes(RELEASE_SIGNING)) {
      if (!DEBUG_SIGNED_RELEASE.test(gradle)) {
        throw new Error("withReleaseSigning: no release signingConfig found");
      }
      gradle = gradle.replace(DEBUG_SIGNED_RELEASE, `$1${RELEASE_SIGNING}`);
    }

    config.modResults.contents = gradle;
    return config;
  });

export default withReleaseSigning;
