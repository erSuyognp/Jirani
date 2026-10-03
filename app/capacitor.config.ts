import type { CapacitorConfig } from "@capacitor/cli";

// Android app: the same web build, bundled into the APK (see "Android app" in the README).
const config: CapacitorConfig = {
  appId: "org.jirani.app",
  appName: "Jirani",
  webDir: "dist",
  backgroundColor: "#002244", // same navy as the splash, so there is no white flash before the first paint
  android: { allowMixedContent: false },
  // Edge-to-edge: the web layout pads itself with --safe-area-inset-*; light icons over the navy app bar.
  plugins: { SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover", style: "DARK" } },
};

export default config;
