import { useSyncExternalStore } from "react";

// Hash routes keep the browser/Android back button working without any
// server-side routing:  #/  #/notifications  #/admin  #/g/:groupId  #/g/:groupId/p/:memberId
export type Route =
  | { name: "home" }
  | { name: "admin" }
  | { name: "notifications" }
  | { name: "group"; groupId: string; tab: GroupTab }
  | { name: "person"; groupId: string; memberId: string };
export type GroupTab = "expenses" | "balances" | "payments" | "insights";
const TABS: GroupTab[] = ["expenses", "balances", "payments", "insights"];

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  if (parts[0] === "admin") return { name: "admin" };
  if (parts[0] === "notifications") return { name: "notifications" };
  if (parts[0] === "g" && parts[1]) {
    if (parts[2] === "p" && parts[3]) return { name: "person", groupId: parts[1], memberId: parts[3] };
    const tab = TABS.includes(parts[2] as GroupTab) ? (parts[2] as GroupTab) : "expenses";
    return { name: "group", groupId: parts[1], tab };
  }
  return { name: "home" };
}

export function href(route: Route): string {
  switch (route.name) {
    case "home": return "#/";
    case "admin": return "#/admin";
    case "notifications": return "#/notifications";
    case "group": return "#/g/" + encodeURIComponent(route.groupId) + (route.tab === "expenses" ? "" : "/" + route.tab);
    case "person": return "#/g/" + encodeURIComponent(route.groupId) + "/p/" + encodeURIComponent(route.memberId);
  }
}

// replace: switch tabs without stacking history entries.
export function navigate(route: Route, { replace = false } = {}) {
  const next = href(route);
  if (replace) history.replaceState(history.state, "", next);
  else history.pushState({ app: true }, "", next);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  if (!replace) window.scrollTo({ top: 0 });
}

export function goBack(fallback: Route) {
  // Only step back through entries this app pushed; otherwise go to the fallback.
  if (history.state?.app) history.back();
  else navigate(fallback, { replace: true });
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash);
  return parse(hash);
}
