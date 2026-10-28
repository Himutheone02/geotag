// The service worker (public/sw.js), run in a stand-in worker scope: fake Cache Storage,
// a fetch that can be switched offline, and the worker's own event handlers.
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGIN = "http://localhost";
const SOURCE = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
const PAGE_HTML = `<!doctype html><link rel="stylesheet" href="/_next/static/css/app-1a2b.css"><script src="/_next/static/chunks/main-abc.js" async></script><script>self.__next_f.push([1,"0:{\\"P\\":[\\"/_next/static/chunks/page-def.js\\"]}"])</script>`;

class FakeCache {
  store = new Map<string, Response>();
  key(request: string | { url: string }) {
    const url = new URL(typeof request === "string" ? request : request.url, ORIGIN);
    return url.pathname + url.search;
  }
  async match(request: string | { url: string }) {
    return this.store.get(this.key(request))?.clone();
  }
  async put(request: string | { url: string }, response: Response) {
    this.store.set(this.key(request), response.clone());
  }
}

function makeWorker(version = "build1") {
  const handlers: Record<string, (event: unknown) => void> = {};
  const caches = new Map<string, FakeCache>();
  const net = { online: true, hang: false, requests: [] as string[] };
  const fetchFn = async (input: string | { url: string }) => {
    const url = new URL(typeof input === "string" ? input : input.url, ORIGIN);
    net.requests.push(url.pathname + url.search);
    if (net.hang) return new Promise<Response>(() => {});
    if (!net.online) throw new TypeError("Failed to fetch");
    if (url.pathname === "/") return new Response(PAGE_HTML, { headers: { "Content-Type": "text/html" } });
    if (url.pathname.startsWith("/missing")) return new Response("no", { status: 404 });
    return new Response(`body of ${url.pathname}`);
  };
  const claimed = { value: false };
  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=${version}`),
    addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => void (claimed.value = true) },
  };
  const cacheStorage = {
    open: async (name: string) => {
      if (!caches.has(name)) caches.set(name, new FakeCache());
      return caches.get(name)!;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };
  vm.runInNewContext(SOURCE, {
    self,
    caches: cacheStorage,
    fetch: fetchFn,
    Response,
    URL,
    Headers,
    Promise,
    setTimeout,
    clearTimeout,
  });

  async function dispatch(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    const event = { ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p) };
    handlers[type](event);
    await Promise.all(waits);
  }
  /** A fetch event; resolves to the worker's response, or null if it let the request through. */
  async function request(url: string, { mode = "no-cors", method = "GET", headers = {} as Record<string, string> } = {}) {
    const out: { responded: Promise<Response> | null } = { responded: null };
    const waits: Promise<unknown>[] = [];
    handlers.fetch({
      request: { url: new URL(url, ORIGIN).href, method, mode, headers: new Headers(headers) },
      respondWith: (p: Promise<Response>) => (out.responded = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    if (!out.responded) return null;
    const response = await out.responded;
    await Promise.all(waits);
    return response;
  }
  const cache = () => caches.get(`geotag-${version}`)!;
  return { dispatch, request, caches, cache, net, claimed };
}

describe("service worker", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("install caches the page, the build files it links to, and the static media", async () => {
    const sw = makeWorker();
    await sw.dispatch("install");
    const cached = [...sw.cache().store.keys()].sort();
    expect(cached).toEqual(
      [
        "/",
        "/manifest.json",
        "/logo.png",
        "/assets/logo-full.webp",
        "/fonts/Fredoka-Variable.woff2",
        "/icons/icon-192.png",
        "/icons/icon-512.png",
        "/icons/icon-maskable-512.png",
        "/icons/apple-touch-icon.png",
        "/icons/favicon-64.png",
        "/_next/static/css/app-1a2b.css",
        "/_next/static/chunks/main-abc.js",
        "/_next/static/chunks/page-def.js", // named only inside the page's inline data
      ].sort(),
    );
  });

  it("every file it precaches exists in /public", () => {
    const listed = [...SOURCE.matchAll(/^\s+"(\/[^"]+)",$/gm)].map((m) => m[1]).filter((p) => p !== "/");
    expect(listed.length).toBeGreaterThan(5);
    for (const file of listed) expect(() => readFileSync(path.join(process.cwd(), "public", file))).not.toThrow();
  });

  it("activate deletes other builds' caches and takes control of open pages", async () => {
    const old = makeWorker("old");
    const sw = makeWorker("new");
    sw.caches.set("geotag-old", old.cache() ?? new FakeCache());
    sw.caches.set("someone-else", new FakeCache());
    await sw.dispatch("install");
    await sw.dispatch("activate");
    expect([...sw.caches.keys()].sort()).toEqual(["geotag-new", "someone-else"]);
    expect(sw.claimed.value).toBe(true);
  });

  it("offline, any page of the game (challenge links too) opens from the cache", async () => {
    const sw = makeWorker();
    await sw.dispatch("install");
    sw.net.online = false;
    const page = await sw.request("/?route=FRA-CHN", { mode: "navigate" });
    expect(page!.status).toBe(200);
    expect(await page!.text()).toBe(PAGE_HTML);
    const chunk = await sw.request("/_next/static/chunks/main-abc.js");
    expect(await chunk!.text()).toBe("body of /_next/static/chunks/main-abc.js");
    const logo = await sw.request("/logo.png");
    expect(await logo!.text()).toBe("body of /logo.png");
  });

  it("online, pages come from the network (so a new deploy shows up)", async () => {
    const sw = makeWorker();
    await sw.dispatch("install");
    sw.net.requests.length = 0;
    await sw.request("/", { mode: "navigate" });
    expect(sw.net.requests).toEqual(["/"]);
  });

  it("on a connection that hangs, the cached page shows after 4 seconds", async () => {
    const sw = makeWorker();
    await sw.dispatch("install");
    sw.net.hang = true;
    const pending = sw.request("/", { mode: "navigate" });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await (await pending)!.text()).toBe(PAGE_HTML);
  });

  it("offline before any online visit: a short explanation, not a browser error", async () => {
    const sw = makeWorker();
    sw.net.online = false;
    const page = await sw.request("/", { mode: "navigate" });
    expect(page!.status).toBe(503);
    expect(await page!.text()).toContain("hasn't opened geotag online yet");
  });

  it("caches the files the page reports (chunks loaded on demand), ours only", async () => {
    const sw = makeWorker();
    await sw.dispatch("install");
    await sw.dispatch("message", {
      data: {
        type: "CACHE_URLS",
        urls: [
          `${ORIGIN}/_next/static/chunks/qr-modal-9f.js`,
          `${ORIGIN}/_next/static/chunks/svg-map-77.js`,
          "https://example.com/tracker.js",
          `${ORIGIN}/?_rsc=abc`,
          `${ORIGIN}/sw.js?v=build1`,
        ],
      },
    });
    const cached = [...sw.cache().store.keys()];
    expect(cached).toContain("/_next/static/chunks/qr-modal-9f.js");
    expect(cached).toContain("/_next/static/chunks/svg-map-77.js");
    expect(cached.some((k) => k.includes("tracker") || k.includes("_rsc") || k.startsWith("/sw.js"))).toBe(false);
    sw.net.online = false;
    expect(await (await sw.request("/_next/static/chunks/qr-modal-9f.js"))!.text()).toContain("qr-modal");
  });

  it("build files are served from the cache without asking the network", async () => {
    const sw = makeWorker();
    await sw.dispatch("install");
    sw.net.requests.length = 0;
    await sw.request("/_next/static/chunks/main-abc.js");
    expect(sw.net.requests).toEqual([]);
  });

  it("leaves other sites, non-GET requests, RSC requests and the worker itself alone", async () => {
    const sw = makeWorker();
    expect(await sw.request("https://example.com/x.js")).toBeNull();
    expect(await sw.request("/", { method: "POST" })).toBeNull();
    expect(await sw.request("/?_rsc=1")).toBeNull();
    expect(await sw.request("/", { headers: { RSC: "1" } })).toBeNull();
    expect(await sw.request("/sw.js?v=build1")).toBeNull();
  });

  it("doesn't cache failed responses", async () => {
    const sw = makeWorker();
    await sw.dispatch("install");
    const missing = await sw.request("/missing.png");
    expect(missing!.status).toBe(404);
    expect(sw.cache().store.has("/missing.png")).toBe(false);
  });
});
