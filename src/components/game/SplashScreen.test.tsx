// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SplashScreen, { READY_TIMEOUT_MS, SPLASH_LOGO_SRC } from "./SplashScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let onPlay: ReturnType<typeof vi.fn<() => void>>;

function render(prepare: () => Promise<unknown> = () => Promise.resolve(), leaving = false) {
  act(() => root.render(<SplashScreen prepare={prepare} leaving={leaving} onPlay={onPlay} />));
}

beforeEach(() => {
  vi.useFakeTimers();
  onPlay = vi.fn<() => void>();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const dialog = () => $<HTMLDivElement>("[role=dialog]")!;
const play = () => $<HTMLButtonElement>(".splash-play")!;
const flush = () => act(async () => {});
const press = (target: HTMLElement, key: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });

describe("SplashScreen", () => {
  it("is a modal dialog named geotag by its logo", () => {
    render();
    expect(dialog().getAttribute("aria-modal")).toBe("true");
    const title = $(`#${dialog().getAttribute("aria-labelledby")}`)!;
    expect(title.querySelector("img")!.alt).toBe("geotag");
    expect($(`#${dialog().getAttribute("aria-describedby")}`)!.textContent).toBe("Tap to start your adventure");
  });

  it("starts with focus on the dialog itself, not PLAY (no focus ring on load)", () => {
    render();
    expect(document.activeElement).toBe(dialog());
    expect(dialog().tabIndex).toBe(-1);
  });

  it("shows the full logo as a plain image: no video, no GIF, no intro wrapper", () => {
    const html = renderToString(createElement(SplashScreen, { prepare: () => Promise.resolve(), leaving: false, onPlay: () => {} }));
    expect(html).not.toContain("<video");
    expect(html).not.toContain("boot-up");
    expect(html).not.toContain("splash__stage");
    const imgs = html.match(/<img[^>]*>/g)!;
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toContain(`src="${SPLASH_LOGO_SRC}"`);
    expect(SPLASH_LOGO_SRC).toBe("/assets/logo-full.webp");
  });

  it("keeps PLAY locked until the background loading finishes", async () => {
    let finish!: () => void;
    render(() => new Promise<void>((resolve) => (finish = resolve)));
    expect(play().getAttribute("aria-disabled")).toBe("true");
    expect($(".splash__loading")!.textContent).toBe("Loading your map and profile…");
    act(() => play().click());
    expect(onPlay).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(play().hasAttribute("aria-disabled")).toBe(false);
    expect($(".splash__loading")!.textContent).toBe("Ready");
    act(() => play().click());
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("starts on Enter or Space while the dialog has focus, once ready", async () => {
    let finish!: () => void;
    render(() => new Promise<void>((resolve) => (finish = resolve)));
    press(dialog(), "Enter");
    expect(onPlay).not.toHaveBeenCalled(); // still loading
    await act(async () => finish());
    press(dialog(), "Escape");
    expect(onPlay).not.toHaveBeenCalled();
    press(dialog(), " ");
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it("leaves keys pressed on PLAY to the button itself (no double start)", async () => {
    render();
    await flush();
    play().focus();
    press(play(), "Enter");
    expect(onPlay).not.toHaveBeenCalled(); // the button's own click handles it in a browser
  });

  it("unlocks PLAY anyway if loading hangs", async () => {
    render(() => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTime(READY_TIMEOUT_MS));
    expect(play().getAttribute("data-ready")).toBe("true");
  });

  it("unlocks PLAY even if loading fails", async () => {
    render(() => Promise.reject(new Error("offline")));
    await flush();
    expect(play().getAttribute("data-ready")).toBe("true");
  });

  it("plays its exit when leaving, and ignores further presses", async () => {
    render();
    await flush();
    render(undefined, true);
    expect($(".splash")!.classList.contains("splash--leaving")).toBe(true);
    act(() => play().click());
    press(dialog(), "Enter");
    expect(onPlay).not.toHaveBeenCalled();
  });
});
