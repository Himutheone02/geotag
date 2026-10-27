"use client";

import { useEffect, useRef, useState } from "react";
import { BRAND_NAME } from "@/utils/share";

/** Brand files for the splash found in /public on the server (null: not there). See page.tsx. */
export type BrandAssets = {
  /** The full logo (mascot and wordmark) the intro lands on, "/assets/logo-full.webp". Without it: a clay globe and the wordmark. */
  splashLogo: string | null;
  /** Boot-up animation, "/assets/boot-up.mp4". */
  introVideo: string | null;
  /** Fallback boot-up animation, "/assets/boot-up.gif". */
  introGif: string | null;
};

/** The exit: the card scales to 105% and the whole splash fades out over this long. */
export const SPLASH_EXIT_MS = 500;
/** PLAY unlocks after this long even if loading hasn't finished (the game works without either). */
export const READY_TIMEOUT_MS = 8000;
/** A GIF has no "ended" event: the brand lands this long after it loads. */
export const GIF_INTRO_MS = 2600;
/** A video that hasn't ended by now (slow network) gives way to the brand anyway. */
export const VIDEO_INTRO_MAX_MS = 8000;

type Intro = "video" | "gif" | "css" | "landed";

type SplashScreenProps = {
  assets: BrandAssets;
  /** Background work PLAY waits for (open IndexedDB, load the map data). Must be stable. */
  prepare: () => Promise<unknown>;
  /** PLAY was pressed: play the exit, and let taps through to the game. */
  leaving: boolean;
  onPlay: () => void;
};

/**
 * Boot-up screen: the animated logo (video, else GIF, else a CSS intro), then the
 * "geotag" signature, a bouncy clay PLAY button, and a loader. PLAY unlocks once the
 * profile database is open and the map data has loaded.
 *
 * It's server-rendered, so it covers the game from the very first paint. The game
 * behind it is `inert` (CountryGuesser) until PLAY: no keyboard focus, hidden from
 * screen readers. Every animation here moves only transform and opacity.
 */
export default function SplashScreen({ assets, prepare, leaving, onPlay }: SplashScreenProps) {
  const fallbackAfterVideo: Intro = assets.introGif ? "gif" : "css";
  const [intro, setIntro] = useState<Intro>(assets.introVideo ? "video" : fallbackAfterVideo);
  const [ready, setReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const gifRef = useRef<HTMLImageElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const gifTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Focus PLAY so Enter or Space starts the game; motion-sensitive players skip the intro.
  useEffect(() => {
    playRef.current?.focus({ preventScroll: true });
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) setIntro("landed");
    return () => clearTimeout(gifTimer.current);
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

  // The video is in the server HTML, so it may have failed or finished before React
  // attached its handlers: check, then make sure it plays (muted, inline).
  useEffect(() => {
    if (intro !== "video") return;
    const video = videoRef.current;
    if (!video) return;
    if (video.error || video.networkState === 3 /* NETWORK_NO_SOURCE */) {
      setIntro(fallbackAfterVideo);
      return;
    }
    if (video.ended) {
      setIntro("landed");
      return;
    }
    video.muted = true;
    // Autoplay can still be refused (e.g. iOS Low Power Mode): a GIF isn't, so fall back to it.
    video.play()?.catch(() => setIntro(fallbackAfterVideo));
    const timer = setTimeout(() => setIntro("landed"), VIDEO_INTRO_MAX_MS);
    return () => clearTimeout(timer);
  }, [intro, fallbackAfterVideo]);

  function gifLoaded() {
    clearTimeout(gifTimer.current);
    gifTimer.current = setTimeout(() => setIntro("landed"), GIF_INTRO_MS);
  }

  // Same for a GIF that was in the server HTML (no video): it may have loaded or failed already.
  useEffect(() => {
    const gif = gifRef.current;
    if (!gif?.complete) return;
    if (gif.naturalWidth > 0) gifLoaded();
    else setIntro("css");
    // Only the server-rendered GIF needs this; one that replaces a failed video reports normally.
  }, []);

  const play = () => {
    if (ready && !leaving) onPlay();
  };

  return (
    <div
      className={leaving ? "splash splash--leaving" : "splash"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="splash-title"
      aria-describedby="splash-tagline"
    >
      <div className="splash__card">
        <div className={assets.splashLogo ? "splash__stage splash__stage--logo" : "splash__stage"} data-intro={intro}>
          {intro === "video" && assets.introVideo && (
            <video
              ref={videoRef}
              className="splash__intro"
              src={assets.introVideo}
              muted
              autoPlay
              playsInline
              preload="auto"
              disablePictureInPicture
              aria-hidden="true"
              onEnded={() => setIntro("landed")}
              onError={() => setIntro(fallbackAfterVideo)}
            />
          )}
          {intro === "gif" && assets.introGif && (
            <img
              ref={gifRef}
              className="splash__intro"
              src={assets.introGif}
              alt=""
              onLoad={gifLoaded}
              onError={() => setIntro("css")}
            />
          )}
          {intro === "css" && (
            <span className="splash__drop" aria-hidden="true" onAnimationEnd={() => setIntro("landed")}>
              <span className="splash__globe" />
            </span>
          )}
          {/* The static signature: always in the page (it names the dialog, and the logo loads
              during the intro), shown once the intro lands. */}
          <h2 id="splash-title" className="splash__signature">
            {assets.splashLogo ? (
              <img className="splash__logo" src={assets.splashLogo} alt={BRAND_NAME} fetchPriority="high" />
            ) : (
              <>
                <span className="splash__globe splash__globe--small" aria-hidden="true" />
                {BRAND_NAME}
              </>
            )}
          </h2>
        </div>

        <button
          ref={playRef}
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
