import { get, post } from "@/lib/api";

// Phone notifications (Web Push) for this browser.
//  - Android / desktop Chrome, Edge, Firefox: work in the browser and the installed app.
//  - iPhone / iPad: only in the installed app (Add to Home Screen), iOS 16.4+.
export type PushState = "unsupported" | "install-first" | "not-set-up" | "blocked" | "off" | "on";

const isIos = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function keyBytes(b64url: string) {
  const s = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIos() && !standalone() ? "install-first" : "unsupported";
  const { publicKey } = await get<{ publicKey: string | null }>("/api/push/key");
  if (!publicKey) return "not-set-up";
  if (Notification.permission === "denied") return "blocked";
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

// Asks permission, subscribes this browser and tells the server.
export async function enablePush(): Promise<PushState> {
  const { publicKey } = await get<{ publicKey: string | null }>("/api/push/key");
  if (!publicKey) return "not-set-up";
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await post("/api/push/subscribe", sub.toJSON());
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await post("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return "off";
}

// After sign-in: a browser that already allows notifications is re-linked to
// whoever is signed in now (quietly; never asks for permission).
export async function syncPushOnSignIn() {
  try {
    if (!supported() || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await post("/api/push/subscribe", sub.toJSON());
  } catch { /* best effort */ }
}

// On sign-out: this device should stop getting the signed-out person's notifications.
export async function forgetPushOnSignOut() {
  try {
    if (!supported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) await post("/api/push/unsubscribe", { endpoint: sub.endpoint });
  } catch { /* best effort */ }
}
