// Split It service worker: makes the app installable and opens it offline
// with the last page it loaded. Pages are always fetched fresh first, so a
// new deploy shows up on the next open; /api and other requests pass through.
const CACHE = "split-it-shell-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put("/", copy)); }
        return res;
      })
      .catch(() => caches.match("/").then(hit => hit || Response.error())),
  );
});

// Phone notifications. The server sends {title, body, link, tag}, encrypted
// for this browser; show it like any app notification.
self.addEventListener("push", event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Split It", {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    tag: data.tag ? data.tag + ":" + (data.link || "") : undefined,
    data: { link: data.link || "#/" },
  }));
});

// Tapping it opens (or focuses) the app on the right screen.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL("/" + String(event.notification.data?.link || "#/").replace(/^\/?/, ""), self.location.origin).href;
  event.waitUntil((async () => {
    const tabs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const tab of tabs) {
      if (new URL(tab.url).origin === self.location.origin) { await tab.focus(); return tab.navigate(target); }
    }
    return self.clients.openWindow(target);
  })());
});
