"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { BRAND_NAME } from "@/utils/share";

/** The full logo (mascot in its ring over the "geotag" wordmark), transparent. */
export const SPLASH_LOGO_SRC = "/assets/logo-full.webp";
/** The exit: the card scales to 105% and the whole splash fades out over this long. */
export const SPLASH_EXIT_MS = 500;
/** PLAY unlocks after this long even if loading hasn't finished (the game works without either). */
export const READY_TIMEOUT_MS = 8000;

type SplashScreenProps = {
  /** Background work PLAY waits for (open IndexedDB, load the map data). Must be stable. */
  prepare: () => Promise<unknown>;
  /** PLAY was pressed: play the exit, and let taps through to the game. */
  leaving: boolean;
  onPlay: () => void;
};

/**
 * Boot-up screen: the full logo, a bouncy clay PLAY button and a loader. PLAY unlocks
 * once the profile database is open and the map data has loaded.
 *
 * It's server-rendered, so it covers the game from the very first paint. The game
 * behind it is `inert` (CountryGuesser) until PLAY: no keyboard focus, hidden from
 * screen readers. Every animation here moves only transform and opacity.
 *
 * Focus starts on the dialog itself, not on PLAY: screen readers announce the dialog,
 * no focus ring shows on load, Enter or Space starts the game, and Tab reaches PLAY
 * (whose focus ring then shows, for keyboard users only).
 */
export default function SplashScreen({ prepare, leaving, onPlay }: SplashScreenProps) {
  const [ready, setReady] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);

  // Load in the background; PLAY unlocks when done (or after a timeout, whatever happens).
  useEffect(() => {
    let live = true;
    const cap = new Promise((resolve) => setTimeout(resolve, READY_TIMEOUT_MS));
    void Promise.race([Promise.allSettled([prepare()]), cap]).then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [prepare]);

  const play = () => {
    if (ready && !leaving) onPlay();
  };

  // Enter or Space while the dialog itself has focus (as it does on load) starts the game.
  // Presses on PLAY are left to the button's own click.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    play();
  };

  return (
    <div
      ref={dialogRef}
      className={leaving ? "splash splash--leaving" : "splash"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-title"
      aria-describedby="splash-tagline"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="splash__card">
        {/* The logo's alt text names the dialog. */}
        <h2 id="splash-title" className="splash__signature">
          <img className="splash__logo" src={SPLASH_LOGO_SRC} alt={BRAND_NAME} fetchPriority="high" />
        </h2>

        <button
          type="button"
          className="splash-play"
          aria-disabled={!ready || undefined}
          data-ready={ready || undefined}
          onClick={play}
        >
          <span className="splash-play__label">PLAY</span>
        </button>
        <p id="splash-tagline" className="splash__tagline">
          Tap to start your adventure
        </p>
        <p className="splash__loading" role="status">
          {ready ? (
            "Ready"
          ) : (
            <>
              <span className="splash-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Loading your map and profile…
            </>
          )}
        </p>
      </div>
    </div>
  );
}
