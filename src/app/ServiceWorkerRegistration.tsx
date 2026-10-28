"use client";

import { useEffect } from "react";

/** Each build registers its own worker URL, so a deploy replaces the old worker and its cache. */
export const SW_URL = `/sw.js?v=${encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID ?? "dev")}`;
/** The page hands its loaded files to the worker twice: once it's ready, and again a little later. */
export const SECOND_HANDOFF_MS = 5000;

/** Same-origin files this page has loaded so far (scripts, chunks loaded on demand, styles, fonts, images). */
export function loadedFiles(): string[] {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return [];
  const origin = window.location.origin;
  return performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => url.startsWith(origin));
}

/**
 * Registers the service worker (public/sw.js), then gives it the list of files this page
 * has loaded, so chunks that load on demand (the map, the QR code) work offline too.
 * Production only: in development a caching worker would serve stale code. Any failure
 * is ignored: offline play is a bonus, and the game works the same without it.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: "/" });
    await navigator.serviceWorker.ready;
    const handOff = () =>
      (registration.active ?? navigator.serviceWorker.controller)?.postMessage({ type: "CACHE_URLS", urls: loadedFiles() });
    handOff();
    setTimeout(handOff, SECOND_HANDOFF_MS);
    return registration;
  } catch {
    return null;
  }
}

/** Mount once, in the root layout. Renders nothing. */
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const register = () => void registerServiceWorker();
    // After the page has loaded, so registering never competes with the game's own files.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  }, []);
  return null;
}
