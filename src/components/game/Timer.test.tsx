// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Timer, { formatElapsed } from "./Timer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("formatElapsed", () => {
  it.each([
    [0, "00:00"],
    [999, "00:00"],
    [1_000, "00:01"],
    [65_000, "01:05"],
    [3_599_000, "59:59"],
    [4_503_000, "75:03"],
  ])("%d ms -> %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });
});

describe("Timer", () => {
  let container: HTMLDivElement;
  let root: Root;
  const text = () => container.querySelector("[role=timer]")!.textContent;
  const render = (isPlaying: boolean, onStop?: (ms: number) => void) =>
    act(() =>
      root.render(
        <StrictMode>
          <Timer isPlaying={isPlaying} onStop={onStop} />
        </StrictMode>,
      ),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("counts up in MM:SS while playing", () => {
    render(true);
    expect(text()).toBe("00:00");
    act(() => vi.advanceTimersByTime(65_000));
    expect(text()).toBe("01:05");
  });

  it("stops on isPlaying=false, reports once, and freezes", () => {
    const onStop = vi.fn();
    render(true, onStop);
    act(() => vi.advanceTimersByTime(12_400));
    render(false, onStop);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onStop.mock.calls[0][0]).toBe(12_400);
    act(() => vi.advanceTimersByTime(30_000));
    expect(text()).toBe("00:12");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("does not report a stop on mount under Strict Mode", () => {
    const onStop = vi.fn();
    render(true, onStop);
    act(() => vi.advanceTimersByTime(2_000));
    expect(onStop).not.toHaveBeenCalled();
  });

  it("stays at 00:00 if never started", () => {
    const onStop = vi.fn();
    render(false, onStop);
    act(() => vi.advanceTimersByTime(5_000));
    expect(text()).toBe("00:00");
    expect(onStop).not.toHaveBeenCalled();
  });

  it("uses wall-clock time, so throttled intervals don't lose seconds", () => {
    render(true);
    // Jump the clock without firing intermediate ticks (like a background tab).
    act(() => {
      vi.setSystemTime(Date.now() + 90_000);
      vi.advanceTimersByTime(250);
    });
    expect(text()).toBe("01:30");
  });
});
