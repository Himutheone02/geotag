// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SplashScreen, { GIF_INTRO_MS, READY_TIMEOUT_MS, type BrandAssets } from "./SplashScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NONE: BrandAssets = { splashLogo: null, introVideo: null, introGif: null };
const BOTH: BrandAssets = { splashLogo: null, introVideo: "/assets/boot-up.mp4", introGif: "/assets/boot-up.gif" };

let container: HTMLDivElement;
let root: Root;
let onPlay: ReturnType<typeof vi.fn<() => void>>;

function render(assets: BrandAssets, prepare: () => Promise<unknown> = () => Promise.resolve(), leaving = false) {
  act(() => root.render(<SplashScreen assets={assets} prepare={prepare} leaving={leaving} onPlay={onPlay} />));
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
const play = () => $<HTMLButtonElement>(".splash-play")!;
const flush = () => act(async () => {});

describe("SplashScreen", () => {
  it("is a modal dialog named geotag, with PLAY focused", () => {
    render(NONE);
    const dialog = $("[role=dialog]")!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect($(`#${dialog.getAttribute("aria-labelledby")}`)!.textContent).toBe("geotag");
    expect($(`#${dialog.getAttribute("aria-describedby")}`)!.textContent).toBe("Tap to start your adventure");
    expect(document.activeElement).toBe(play());
  });

  it("keeps PLAY locked until the background loading finishes", async () => {
    let finish!: () => void;
    render(NONE, () => new Promise<void>((resolve) => (finish = resolve)));
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

  it("unlocks PLAY anyway if loading hangs", async () => {
    render(NONE, () => new Promise(() => {}));
    await act(async () => vi.advanceTimersByTime(READY_TIMEOUT_MS));
    expect(play().getAttribute("data-ready")).toBe("true");
  });

  it("unlocks PLAY even if loading fails", async () => {
    render(NONE, () => Promise.reject(new Error("offline")));
    await flush();
    expect(play().getAttribute("data-ready")).toBe("true");
  });

  it("server-renders the video muted, autoplaying and inline (no media-blocker prompt)", () => {
    const html = renderToString(createElement(SplashScreen, { assets: BOTH, prepare: () => Promise.resolve(), leaving: false, onPlay: () => {} }));
    const video = /<video[^>]*>/.exec(html)![0].toLowerCase();
    for (const attr of ['muted=""', 'autoplay=""', 'playsinline=""', 'src="/assets/boot-up.mp4"']) expect(video).toContain(attr);
    expect(html).toContain('role="dialog"');
  });

  it("falls back from the video to the GIF to the CSS intro, then lands on the signature", () => {
    render(BOTH);
    const video = $<HTMLVideoElement>("video")!;
    expect(video.muted).toBe(true);
    act(() => {
      video.dispatchEvent(new Event("error"));
    });
    const gif = $<HTMLImageElement>("img.splash__intro")!;
    expect(gif.getAttribute("src")).toBe("/assets/boot-up.gif");
    act(() => {
      gif.dispatchEvent(new Event("error"));
    });
    expect($(".splash__drop")).not.toBeNull();
    act(() => {
      $(".splash__drop")!.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect($(".splash__stage")!.getAttribute("data-intro")).toBe("landed");
    expect($(".splash__drop")).toBeNull();
  });

  it("lands when the video ends", () => {
    render({ ...NONE, introVideo: "/assets/boot-up.mp4" });
    act(() => {
      $("video")!.dispatchEvent(new Event("ended"));
    });
    expect($(".splash__stage")!.getAttribute("data-intro")).toBe("landed");
  });

  it("shows a GIF for a fixed time after it loads (a GIF has no end event)", () => {
    // happy-dom reports every new image as already complete; a browser reports it loading.
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(false);
    render({ ...NONE, introGif: "/assets/boot-up.gif" });
    act(() => {
      $("img")!.dispatchEvent(new Event("load"));
    });
    act(() => vi.advanceTimersByTime(GIF_INTRO_MS - 1));
    expect($(".splash__stage")!.getAttribute("data-intro")).toBe("gif");
    act(() => vi.advanceTimersByTime(1));
    expect($(".splash__stage")!.getAttribute("data-intro")).toBe("landed");
  });

  it("moves on if a server-rendered GIF had already failed before the page was interactive", () => {
    vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    render({ ...NONE, introGif: "/assets/boot-up.gif" });
    expect($(".splash__drop")).not.toBeNull();
  });

  it("lands on the full logo when there is one; it still names the dialog", () => {
    render({ ...NONE, splashLogo: "/assets/logo-full.webp" });
    const title = $("#splash-title")!;
    const logo = title.querySelector<HTMLImageElement>("img.splash__logo")!;
    expect(logo.getAttribute("src")).toBe("/assets/logo-full.webp");
    expect(logo.alt).toBe("geotag");
    expect(title.querySelector(".splash__globe")).toBeNull(); // no stand-in globe or text beside it
    expect(title.textContent).toBe("");
    expect($(".splash__stage")!.classList.contains("splash__stage--logo")).toBe(true);
    // The intro still plays first; the logo springs in when it lands.
    act(() => {
      $(".splash__drop")!.dispatchEvent(new Event("animationend", { bubbles: true }));
    });
    expect($(".splash__stage")!.getAttribute("data-intro")).toBe("landed");
  });

  it("uses the CSS intro when there's no video or GIF", () => {
    render(NONE);
    expect($("video")).toBeNull();
    expect($(".splash__drop")).not.toBeNull();
  });

  it("skips the intro for players who prefer reduced motion", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    render(BOTH);
    expect($(".splash__stage")!.getAttribute("data-intro")).toBe("landed");
  });

  it("plays its exit when leaving, and ignores further presses", async () => {
    render(NONE);
    await flush();
    render(NONE, undefined, true);
    expect($(".splash")!.classList.contains("splash--leaving")).toBe(true);
    act(() => play().click());
    expect(onPlay).not.toHaveBeenCalled();
  });
});
