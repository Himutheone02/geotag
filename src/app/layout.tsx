import type { Metadata } from "next";
import { BRAND_NAME } from "@/utils/share";
import "./globals.css";

// Inline favicon (a pastel clay dot) so no extra file is needed in /src/app or /public.
const FAVICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><radialGradient id="g" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#e6eeff"/><stop offset="1" stop-color="#a8c5ff"/></radialGradient></defs><circle cx="32" cy="32" r="28" fill="url(#g)"/></svg>',
  );

export const metadata: Metadata = {
  title: BRAND_NAME,
  applicationName: BRAND_NAME,
  description: "Name every sovereign state. Typos forgiven, guesses not.",
  icons: { icon: FAVICON },
};

/**
 * Runs before the page paints. When the page was opened from a challenge link (?route=),
 * it hides the setup screen until the game has read the link, so the player goes
 * straight into the route instead of seeing the setup screen flash first. If the game's
 * script never loads, the setup screen comes back after 4 seconds.
 */
const CHALLENGE_PENDING_SCRIPT = `(function(){try{if(/[?&]route=/.test(location.search)){var d=document.documentElement;d.setAttribute("data-challenge","pending");setTimeout(function(){d.removeAttribute("data-challenge")},4000)}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The script above may set data-challenge before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: CHALLENGE_PENDING_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
