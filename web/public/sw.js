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
