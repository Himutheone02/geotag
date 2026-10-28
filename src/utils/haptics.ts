/**
 * Haptic feedback: one short buzz, where the browser supports it.
 *
 * Support: Chrome-based browsers on Android. No iPhone or iPad browser has the
 * Vibration API (WebKit never shipped it), and desktop browsers that expose it have
 * nothing to vibrate. Every call is feature-checked, so unsupported browsers just
 * do nothing. Browsers also ignore it until the person has tapped or typed on the page.
 */

/** A short tap: 30 ms. */
export const TAP_PATTERN: readonly number[] = [30];

/** Whether this browser has the Vibration API. */
export function canVibrate(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

/**
 * Whether haptics are worth offering here: the API exists and the device is touch-first
 * (a phone or tablet), so the toggle isn't shown where it could only do nothing.
 */
export function hapticsUseful(): boolean {
  return canVibrate() && typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches === true;
}

/** Buzz briefly. Never throws; returns whether the browser accepted the request. */
export function vibrate(pattern: readonly number[] = TAP_PATTERN): boolean {
  if (!canVibrate()) return false;
  try {
    return navigator.vibrate([...pattern]);
  } catch {
    return false;
  }
}
