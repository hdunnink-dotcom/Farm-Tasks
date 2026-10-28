const CACHE_NAME = "farm-planner-shell-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./favicon-maskable.svg",
  "./icon-32.png",
  "./apple-touch-icon.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-192.png",
  "./icon-maskable-512.png",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;
  // Only browser document navigations may use the app-shell fallback. An
  // Accept header is not enough: scripts, stylesheets, and other resources
  // can also advertise that they accept HTML.
  const isNavigation = request.mode === "navigate";

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => {
        if (cached) return cached;
        // Only document navigations may fall back to the app shell. Returning
        // index.html for a failed JS/CSS chunk makes the browser parse HTML as
        // a module and turns a recoverable cache miss into a route crash.
        return isNavigation
          ? caches.match("./index.html").then((shell) => shell || Response.error())
          : Response.error();
      })),
  );
});