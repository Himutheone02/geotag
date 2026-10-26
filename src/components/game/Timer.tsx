"use client";

import { useEffect, useRef, useState } from "react";

type TimerProps = {
  /** Counts up while true. Going from true to false stops it for good. */
  isPlaying: boolean;
  /** Called once when the timer stops, with the exact elapsed time in ms. */
  onStop?: (elapsedMs: number) => void;
};

/** 75_000 -> "01:15". Minutes keep counting past 59 ("75:03"). */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Count-up stopwatch (MM:SS).
 *
 * Owns its own state so each tick re-renders only this component, never the
 * game around it. Elapsed time is computed from timestamps rather than by
 * counting ticks, so it stays accurate when browsers throttle setInterval in
 * background tabs. The display updates at most once per second: setting the
 * same whole-second value again is a no-op for React.
 *
 * Remount it (change its `key`) to start a fresh session.
 */
export default function Timer({ isPlaying, onStop }: TimerProps) {
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef<number | null>(null);
  const wasPlaying = useRef(false);
  const onStopRef = useRef(onStop);

  useEffect(() => {
    onStopRef.current = onStop;
  });

  // Run the interval only while playing.
  useEffect(() => {
    if (!isPlaying) return;
    if (startedAt.current === null) startedAt.current = Date.now();
    const id = setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt.current!) / 1000));
    }, 250);
    return () => clearInterval(id);
  }, [isPlaying]);

  // Report the stop exactly once, on the true -> false transition.
  // (Not in the interval's cleanup: that also runs on unmount and on
  // React Strict Mode's simulated remount, which would report false stops.)
  useEffect(() => {
    if (wasPlaying.current && !isPlaying && startedAt.current !== null) {
      const elapsed = Date.now() - startedAt.current;
      setSeconds(Math.floor(elapsed / 1000));
      onStopRef.current?.(elapsed);
    }
    wasPlaying.current = isPlaying;
  }, [isPlaying]);

  return (
    <p className="timer" role="timer" aria-label="Elapsed time">
      {formatElapsed(seconds * 1000)}
    </p>
  );
}
