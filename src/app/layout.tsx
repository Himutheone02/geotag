import type { Metadata, Viewport } from "next";
import { BRAND_NAME } from "@/utils/share";
import ServiceWorkerRegistration from "./ServiceWorkerRegistration";
import "./globals.css";

export const metadata: Metadata = {
  title: BRAND_NAME,
  applicationName: BRAND_NAME,
  description: "Name every sovereign state. Typos forgiven, guesses not.",
  // <link rel="manifest" href="/manifest.json">: installable as a standalone app (public/manifest.json).
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/icons/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // iPhone and iPad home screens use this, not the manifest's icons.
    apple: { url: "/icons/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: { capable: true, title: BRAND_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f3efff", // the page's lilac, as in the manifest
};

/**
 * Runs before the page paints. When the page was opened from a challenge link (?route=),
 * it hides the boot-up splash for good and the setup screen until the game has read the
 * link, so the player goes straight into the route. If the game's script never loads,
 * the setup screen comes back after 4 seconds.
 */
const CHALLENGE_PENDING_SCRIPT = `(function(){try{if(/[?&]route=/.test(location.search)){var d=document.documentElement;d.setAttribute("data-challenge","pending");d.setAttribute("data-skip-splash","");setTimeout(function(){d.removeAttribute("data-challenge")},4000)}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The script above may set data-challenge before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHALLENGE_PENDING_SCRIPT }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
