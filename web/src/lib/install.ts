import { useSyncExternalStore } from "react";

// Chrome/Edge on Android (and desktop) fire `beforeinstallprompt` when the app
// can be installed; we keep the event so an "Install app" button can show the
// real install dialog. iPhone/iPad never fire it: there the app is added from
// the Share menu, so we show those steps instead.
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: PromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function listenForInstall() {
  if (typeof window === "undefined") return;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e as PromptEvent; emit(); });
  window.addEventListener("appinstalled", () => { deferred = null; installed = true; emit(); });
  if ("serviceWorker" in navigator) window.addEventListener("load", () => { navigator.serviceWorker.register("/sw.js").catch(() => {}); });
}

export type InstallPlatform = "ios-safari" | "ios-other" | "android" | "desktop";
function platform(): InstallPlatform {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari";
  return /Android/i.test(ua) ? "android" : "desktop";
}
// Already running as the installed app (home-screen icon).
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const snapshot = () => (deferred ? "prompt" : "") + (installed ? "installed" : "");

export function useInstall() {
  useSyncExternalStore(subscribe, snapshot, () => "");
  return {
    platform: platform(),
    // Hide install options inside the installed app.
    isInstalled: installed || standalone(),
    canPrompt: !!deferred,
    // Opens Chrome's own install dialog; resolves true if the user accepted.
    prompt: async () => {
      if (!deferred) return false;
      const e = deferred;
      deferred = null; emit();
      await e.prompt();
      return (await e.userChoice).outcome === "accepted";
    },
  };
}
