import type { NextConfig } from "next";

/**
 * One id per build. The service worker is registered as /sw.js?v=<id>, so every deploy
 * installs a fresh worker that caches the new build and deletes the old build's cache.
 * Set GEOTAG_BUILD_ID to pin it (e.g. to a commit hash).
 */
const buildId = process.env.GEOTAG_BUILD_ID ?? new Date().toISOString().replace(/\D/g, "").slice(0, 14);

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};

export default nextConfig;
