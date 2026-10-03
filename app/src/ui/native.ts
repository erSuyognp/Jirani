// Android shell glue: system bars, hardware back button, haptics. Every call is a no-op in the browser.
import { App as NativeApp } from "@capacitor/app";
import { Capacitor, SystemBars, SystemBarsStyle, SystemBarType } from "@capacitor/core";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export const isNative = Capacitor.isNativePlatform();

/** Light icons over the navy app bar, dark icons over the white bottom bar. */
export function styleSystemBars() {
  if (!isNative) return;
  SystemBars.setStyle({ style: SystemBarsStyle.Dark, bar: SystemBarType.StatusBar }).catch(() => undefined);
  SystemBars.setStyle({ style: SystemBarsStyle.Light, bar: SystemBarType.NavigationBar }).catch(() => undefined);
}

/** Route the hardware back button / back gesture to the app. Returns an unsubscribe function. */
export function onBackButton(handler: () => void): () => void {
  if (!isNative) return () => undefined;
  const h = NativeApp.addListener("backButton", handler);
  return () => { h.then((x) => x.remove()).catch(() => undefined); };
}

export function leaveApp() {
  if (isNative) NativeApp.minimizeApp().catch(() => undefined);
}

export function tap() {
  if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => undefined);
}

export function buzz(kind: "ok" | "bad") {
  if (!isNative) return;
  Haptics.notification({ type: kind === "ok" ? NotificationType.Success : NotificationType.Error }).catch(() => undefined);
}
