// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KEYBOARD_MIN_PX, readViewport, watchVisualViewport } from "./viewport";

/** A stand-in for window.visualViewport that tests can resize and pan. */
class FakeViewport extends EventTarget {
  width = 390;
  height = 844;
  offsetTop = 0;
  scale = 1;
  set(next: Partial<Pick<FakeViewport, "width" | "height" | "offsetTop" | "scale">>) {
    Object.assign(this, next);
    this.dispatchEvent(new Event("resize"));
  }
}

describe("readViewport", () => {
  it("calls a big drop from the tallest height a keyboard, and a toolbar-sized one not", () => {
    expect(readViewport({ height: 844, offsetTop: 0, scale: 1 }, 844).keyboard).toBe(false);
    expect(readViewport({ height: 844 - 80, offsetTop: 0, scale: 1 }, 844).keyboard).toBe(false); // toolbar
    expect(readViewport({ height: 844 - KEYBOARD_MIN_PX, offsetTop: 0, scale: 1 }, 844).keyboard).toBe(true);
    expect(readViewport({ height: 500, offsetTop: 120, scale: 1 }, 844)).toEqual({ height: 500, top: 120, keyboard: true });
  });

  it("doesn't mistake pinch-zoom for a keyboard", () => {
    expect(readViewport({ height: 422, offsetTop: 0, scale: 2 }, 844).keyboard).toBe(false);
  });
});

describe("watchVisualViewport", () => {
  let root: HTMLElement;
  let vv: FakeViewport;
  const flush = () => vi.runAllTimers();

  beforeEach(() => {
    vi.useFakeTimers();
    root = document.createElement("div");
    vv = new FakeViewport();
  });
  afterEach(() => vi.useRealTimers());

  it("mirrors the visible area onto CSS variables, and flags the keyboard", () => {
    const stop = watchVisualViewport(root, vv as unknown as VisualViewport);
    expect(root.style.getPropertyValue("--vv-height")).toBe("844px");
    expect(root.hasAttribute("data-keyboard")).toBe(false);

    vv.set({ height: 520, offsetTop: 260 }); // iPhone: the keyboard slides up, the page pans
    flush();
    expect(root.style.getPropertyValue("--vv-height")).toBe("520px");
    expect(root.style.getPropertyValue("--vv-top")).toBe("260px");
    expect(root.hasAttribute("data-keyboard")).toBe(true);

    vv.set({ height: 844, offsetTop: 0 }); // keyboard down
    flush();
    expect(root.hasAttribute("data-keyboard")).toBe(false);

    stop();
    expect(root.style.getPropertyValue("--vv-height")).toBe("");
  });

  it("starts over on rotation, so landscape's shorter screen isn't a keyboard", () => {
    watchVisualViewport(root, vv as unknown as VisualViewport);
    vv.set({ width: 844, height: 390 });
    flush();
    expect(root.hasAttribute("data-keyboard")).toBe(false);
    vv.set({ height: 180 }); // keyboard in landscape
    flush();
    expect(root.hasAttribute("data-keyboard")).toBe(true);
  });

  it("applies once per frame however many events arrive", () => {
    const set = vi.spyOn(root.style, "setProperty");
    watchVisualViewport(root, vv as unknown as VisualViewport);
    set.mockClear();
    for (let i = 0; i < 10; i++) vv.set({ height: 800 - i * 30 });
    flush();
    expect(set.mock.calls.filter(([name]) => name === "--vv-height")).toHaveLength(1);
  });

  it("does nothing without the Visual Viewport API", () => {
    expect(() => watchVisualViewport(root, null)()).not.toThrow();
    expect(root.hasAttribute("data-keyboard")).toBe(false);
  });
});
