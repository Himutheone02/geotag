import { afterEach, describe, expect, it, vi } from "vitest";
import { canVibrate, hapticsUseful, TAP_PATTERN, vibrate } from "./haptics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("haptics", () => {
  it("does nothing, without throwing, where there's no Vibration API (iPhone, Node)", () => {
    vi.stubGlobal("navigator", {});
    expect(canVibrate()).toBe(false);
    expect(vibrate()).toBe(false);
    vi.stubGlobal("navigator", undefined);
    expect(canVibrate()).toBe(false);
    expect(vibrate()).toBe(false);
  });

  it("buzzes for 30 ms where it can", () => {
    const buzz = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate: buzz });
    expect(vibrate()).toBe(true);
    expect(buzz).toHaveBeenCalledWith([30]);
    expect(TAP_PATTERN).toEqual([30]);
  });

  it("swallows a browser that throws", () => {
    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("blocked");
      },
    });
    expect(vibrate()).toBe(false);
  });

  it("offers the toggle only on touch-first devices that can vibrate", () => {
    vi.stubGlobal("navigator", { vibrate: () => true });
    vi.stubGlobal("window", { matchMedia: (q: string) => ({ matches: q === "(pointer: coarse)" }) });
    expect(hapticsUseful()).toBe(true);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) }); // desktop: mouse
    expect(hapticsUseful()).toBe(false);
    vi.stubGlobal("navigator", {}); // iPhone: coarse pointer, no API
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    expect(hapticsUseful()).toBe(false);
  });
});
