import type { CapacitorConfig } from "@capacitor/cli";

// Android app: the same web build, bundled into the APK (see "Android app" in the README).
const config: CapacitorConfig = {
  appId: "org.jirani.app",
  appName: "Jirani",
  webDir: "dist",
  android: { allowMixedContent: false },
};

export default config;
