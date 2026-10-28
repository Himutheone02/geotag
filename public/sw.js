/*
 * geotag's service worker: plain JavaScript, no libraries. After one online visit the
 * whole game opens and plays with no connection at all.
 *
 * - Install: caches the page (which carries the country data: countries.json is built
 *   into it), the JavaScript and CSS it links to, the font, the logos and the icons.
 * - The page also hands over every file it has loaded (the map and QR code chunks, which
 *   load on demand and aren't linked from the page), so those are cached too.
 * - Pages: network first, so an online player always gets the latest build; offline (or
 *   after 4 s without an answer), the cached page. Any ?route= link opens it too. The
 *   cached page is always the one this worker installed with, so it matches the cached
 *   build files; a new deploy brings a new worker with its own page.
 * - Build files (/_next/static/, named by content): cache first; they never change.
 * - Everything else of ours (logos, icons, font): from the cache, refreshed in the background.
 *
 * Registered as /sw.js?v=<build id>: each deploy installs a new worker, which caches the
 * new build and deletes older caches.
 */

const VERSION = new URL(self.location.href).searchParams.get("v") || "1";
const CACHE = `geotag-${VERSION}`;
const PAGE = "/";
const PRECACHE = [
  PAGE,
  "/manifest.json",
  "/logo.png",
  "/assets/logo-full.webp",
  "/fonts/Fredoka-Variable.woff2",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon-64.png",
];
const NETWORK_TIMEOUT_MS = 4000;

/** Same-origin URLs the page links to under /_next/static/ (scripts, styles, chunks). */
function buildFilesIn(html) {
  const found = new Set();
  for (const match of html.matchAll(/\/_next\/static\/[^"'\s\\)<>]+/g)) found.add(match[0]);
  return [...found];
}

/** Caches each URL that isn't cached yet. One failure doesn't stop the rest. */
async function cacheAll(cache, urls) {
  await Promise.allSettled(
    urls.map(async (url) => {
      if (await cache.match(url)) return;
      const response = await fetch(url, { cache: "no-cache" });
      if (response.ok) await cache.put(url, response);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cacheAll(cache, PRECACHE);
      const page = await cache.match(PAGE);
      if (page) await cacheAll(cache, buildFilesIn(await page.text()));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((name) => name.startsWith("geotag-") && name !== CACHE).map((name) => caches.delete(name)));
      await self.clients.claim();
    })(),
  );
});

/** The page tells us what it has loaded: cache whatever of ours isn't cached yet. */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "CACHE_URLS" || !Array.isArray(data.urls)) return;
  const ours = data.urls
    .map((u) => {
      try {
        return new URL(u, self.location.origin);
      } catch {
        return null;
      }
    })
    .filter((u) => u && u.origin === self.location.origin && !u.searchParams.has("_rsc") && u.pathname !== "/sw.js")
    .map((u) => u.pathname + u.search);
  event.waitUntil(caches.open(CACHE).then((cache) => cacheAll(cache, ours)));
});

async function pageNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    return await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NETWORK_TIMEOUT_MS)),
    ]);
  } catch {
    const cached = await cache.match(PAGE);
    return (
      cached ||
      new Response("<!doctype html><title>geotag</title><p>You're offline, and this device hasn't opened geotag online yet.</p>", {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(async (response) => {
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // React Server Component requests and the worker itself always go to the network.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC") || url.pathname === "/sw.js") return;

  if (request.mode === "navigate") event.respondWith(pageNetworkFirst(request));
  else if (url.pathname.startsWith("/_next/static/")) event.respondWith(cacheFirst(request));
  else event.respondWith(staleWhileRevalidate(event));
});
