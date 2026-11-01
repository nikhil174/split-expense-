import * as React from "react";
import { toast } from "sonner";

// Phones keep an installed app (or an open tab) running for days, so they can
// be on an older version than the server. The build publishes /version.json;
// this checks it when the app opens, when it comes back to the front, and
// every few minutes. When a newer build is live it reloads at a safe moment
// (coming back to the app), or the person taps "Update" in the message.
const CHECK_MS = 5 * 60 * 1000;
let reloading = false;

async function liveBuild(): Promise<string | null> {
  try {
    const r = await fetch("/version.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()).build || null;
  } catch { return null; }
}
// Reload at most once for a given new build: if the page that comes back is
// still not that build (a cache, a deploy still spreading), don't loop; the
// "Update" message is shown instead.
const TRIED = "split-it-update-tried";
function tried(build: string) { try { return sessionStorage.getItem(TRIED) === build; } catch { return true; } }
function reload(build: string) {
  if (reloading || tried(build)) return false;
  reloading = true;
  try { sessionStorage.setItem(TRIED, build); } catch { /* private mode: tried() already said no */ }
  location.reload();
  return true;
}

export function useAppUpdate() {
  React.useEffect(() => {
    if (__BUILD__.startsWith("local")) return; // local development: builds change all the time
    let outdated: string | null = null, shown = false;
    const offer = (live: string) => {
      if (shown) return;
      shown = true;
      toast("A new version of Split It is ready.", { duration: Infinity, action: { label: "Update", onClick: () => { try { sessionStorage.removeItem(TRIED); } catch { /* */ } reloading = false; reload(live); } } });
    };
    const check = async (fromBackground: boolean) => {
      const live = await liveBuild();
      if (!live || live === __BUILD__) return;
      outdated = live;
      // Coming back to the app (or just opened it): nothing is in progress, update now.
      if (fromBackground && reload(live)) return;
      offer(live);
    };
    check(true);
    const onVisible = () => { if (document.visibilityState === "visible") { if (outdated) { if (!reload(outdated)) offer(outdated); } else check(true); } };
    document.addEventListener("visibilitychange", onVisible);
    const t = window.setInterval(() => { if (document.visibilityState === "visible") check(false); }, CHECK_MS);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearInterval(t); };
  }, []);
}
