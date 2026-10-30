/**
 * The on-screen keyboard, seen through the Visual Viewport API.
 *
 * `100dvh` alone can't see the keyboard: the dynamic viewport units follow the browser's
 * toolbars, not the keyboard. On iPhone the keyboard slides over the page and the layout
 * viewport keeps its height; on Android Chrome it does the same unless the page opts in with
 * `interactive-widget=resizes-content` (set in layout.tsx). What does shrink, everywhere, is
 * the visual viewport: the part of the page actually visible above the keyboard.
 *
 * So this mirrors the visual viewport onto <html> as CSS variables, `--vv-height` and
 * `--vv-top` (how far the browser has panned the page under it), and sets `data-keyboard`
 * while a keyboard is up. The CSS (globals.css, "Typing on a phone") then pins the map and the
 * answer field into exactly that space.
 */

/**
 * How much shorter than its tallest the visible area must get before the gap counts as a
 * keyboard. Browser toolbars collapsing or expanding move it by well under this; on-screen
 * keyboards take 250 px or more.
 */
export const KEYBOARD_MIN_PX = 150;

type VisualViewportLike = Pick<VisualViewport, "width" | "height" | "offsetTop" | "scale" | "addEventListener" | "removeEventListener">;

export type ViewportState = {
  /** Visible height in CSS px. */
  height: number;
  /** How far the visible area sits below the top of the layout viewport (iOS pans it). */
  top: number;
  keyboard: boolean;
};

/**
 * Pure: reads one visual viewport sample against the tallest it has been at this width.
 * Height is compared at scale 1, so pinch-zooming in isn't mistaken for a keyboard.
 */
export function readViewport(vv: Pick<VisualViewport, "height" | "offsetTop" | "scale">, tallest: number): ViewportState {
  return { height: vv.height, top: vv.offsetTop, keyboard: tallest - vv.height * (vv.scale || 1) >= KEYBOARD_MIN_PX };
}

/** Starts mirroring the visual viewport onto `root`. Returns the cleanup. A no-op without the API. */
export function watchVisualViewport(
  root: HTMLElement = document.documentElement,
  vv: VisualViewportLike | null | undefined = typeof window === "undefined" ? null : window.visualViewport,
): () => void {
  if (!vv) return () => {};
  // Widths and heights at scale 1 (as if not pinch-zoomed).
  const unzoomed = (px: number) => px * (vv.scale || 1);
  let width = unzoomed(vv.width);
  let tallest = unzoomed(vv.height);
  let frame = 0;

  const apply = () => {
    frame = 0;
    // Rotating the phone changes what "full height" means: start over.
    if (Math.abs(unzoomed(vv.width) - width) > 1) {
      width = unzoomed(vv.width);
      tallest = 0;
    }
    tallest = Math.max(tallest, unzoomed(vv.height));
    const state = readViewport(vv, tallest);
    root.style.setProperty("--vv-height", `${Math.round(state.height)}px`);
    root.style.setProperty("--vv-top", `${Math.round(state.top)}px`);
    if (state.keyboard) root.setAttribute("data-keyboard", "");
    else root.removeAttribute("data-keyboard");
  };
  // Resize and scroll can fire many times a frame while the keyboard animates: apply once per frame.
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };

  apply();
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    vv.removeEventListener("resize", schedule);
    vv.removeEventListener("scroll", schedule);
    root.style.removeProperty("--vv-height");
    root.style.removeProperty("--vv-top");
    root.removeAttribute("data-keyboard");
  };
}
