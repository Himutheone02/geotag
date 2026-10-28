// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import ServiceWorkerRegistration, { registerServiceWorker, SECOND_HANDOFF_MS, SW_URL } from "./ServiceWorkerRegistration";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function fakeServiceWorker({ fail = false } = {}) {
  const postMessage = vi.fn();
  const registration = { active: { postMessage } };
  const register = vi.fn(async () => {
    if (fail) throw new Error("SecurityError");
    return registration;
  });
  Object.defineProperty(navigator, "serviceWorker", {
    value: { register, ready: Promise.resolve(registration), controller: null },
    configurable: true,
  });
  return { register, postMessage };
}

afterEach(() => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("service worker registration", () => {
  it("registers this build's worker for the whole site, then hands it the files the page loaded, twice", async () => {
    vi.useFakeTimers();
    const sw = fakeServiceWorker();
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { name: `${location.origin}/_next/static/chunks/svg-map.js` },
      { name: "https://elsewhere.example/x.js" },
    ] as PerformanceEntryList);
    expect(await registerServiceWorker()).not.toBeNull();
    expect(sw.register).toHaveBeenCalledWith(SW_URL, { scope: "/" });
    expect(SW_URL).toMatch(/^\/sw\.js\?v=/);
    const message = { type: "CACHE_URLS", urls: [`${location.origin}/_next/static/chunks/svg-map.js`] };
    expect(sw.postMessage).toHaveBeenCalledWith(message);
    vi.advanceTimersByTime(SECOND_HANDOFF_MS);
    expect(sw.postMessage).toHaveBeenCalledTimes(2);
  });

  it("is a no-op where service workers don't exist, and swallows a failed registration", async () => {
    expect(await registerServiceWorker()).toBeNull();
    fakeServiceWorker({ fail: true });
    expect(await registerServiceWorker()).toBeNull();
  });

  it("doesn't register outside production builds (a caching worker would serve stale code in development)", () => {
    const sw = fakeServiceWorker();
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<ServiceWorkerRegistration />));
    window.dispatchEvent(new Event("load"));
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(sw.register).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe("web app manifest", () => {
  const manifest = JSON.parse(readFileSync(path.join(process.cwd(), "public", "manifest.json"), "utf8"));
  /** Width and height from a PNG's header. */
  const pngSize = (file: string) => {
    const bytes = readFileSync(path.join(process.cwd(), "public", file));
    return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
  };

  it("is a standalone app that starts at the game", () => {
    expect(manifest).toMatchObject({ name: "geotag", short_name: "geotag", display: "standalone", start_url: "/", scope: "/" });
    expect(manifest.theme_color).toBe("#f3efff");
  });

  it("has square PNG icons whose declared sizes are their real sizes, 192, 512 and a maskable one", () => {
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(pngSize(icon.src)).toBe(icon.sizes);
      const [w, h] = icon.sizes.split("x");
      expect(w).toBe(h);
    }
    const sizes = manifest.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes} ${i.purpose}`);
    expect(sizes).toEqual(expect.arrayContaining(["192x192 any", "512x512 any", "512x512 maskable"]));
    expect(pngSize("/icons/apple-touch-icon.png")).toBe("180x180");
  });
});
