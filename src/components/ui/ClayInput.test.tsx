// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ClayInput, { SUGGEST_EXIT_MS, type ClayInputOption } from "./ClayInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTIONS: ClayInputOption[] = [
  { key: "BRA", label: "Brazil" },
  { key: "BRN", label: "Brunei" },
  { key: "GBR", label: "United Kingdom", detail: "as Britain" },
];

let container: HTMLDivElement;
let root: Root;
let picked: string[];
let submits: number;
let setOptions: (o: ClayInputOption[] | undefined) => void;

function Harness({ initial }: { initial: ClayInputOption[] | undefined }) {
  const [options, set] = useState(initial);
  setOptions = set;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submits++;
      }}
    >
      <ClayInput label="Country" suggestions={options} onPickSuggestion={(o) => picked.push(o.key)} />
      <button type="submit">Check</button>
    </form>
  );
}

/** null: no `suggestions` prop at all. */
function mount(initial: ClayInputOption[] | null = OPTIONS) {
  act(() => root.render(<Harness initial={initial ?? undefined} />));
  act(() => input().focus());
}

beforeEach(() => {
  vi.useFakeTimers();
  picked = [];
  submits = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const input = () => container.querySelector("input")!;
const list = () => container.querySelector<HTMLElement>("[role=listbox]");
const options = () => [...container.querySelectorAll<HTMLElement>("[role=option]")];
const press = (key: string) => {
  let event!: KeyboardEvent;
  act(() => {
    event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    input().dispatchEvent(event);
  });
  return event;
};
/** Enter in a real browser: keydown, then (unless prevented) implicit form submission. */
const pressEnter = () => {
  if (!press("Enter").defaultPrevented) act(() => input().form!.requestSubmit());
};

describe("ClayInput as a combobox", () => {
  it("is a plain text field when no suggestions are passed", () => {
    mount(null);
    expect(input().getAttribute("role")).toBeNull();
    expect(list()).toBeNull();
  });

  it("shows the options in a clay card below the field, wired up for screen readers", () => {
    mount();
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-controls")).toBe(list()!.id);
    expect(list()!.classList.contains("clay-card")).toBe(true);
    expect(options().map((o) => o.textContent)).toEqual(["Brazil", "Brunei", "United Kingdomas Britain"]);
  });

  it("stays closed until the field has focus", () => {
    act(() => root.render(<Harness initial={OPTIONS} />));
    expect(list()).toBeNull();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("arrows move the highlight, wrapping at both ends", () => {
    mount();
    const active = () => input().getAttribute("aria-activedescendant");
    expect(active()).toBeNull();
    press("ArrowDown");
    expect(active()).toBe(options()[0].id);
    expect(options()[0].getAttribute("aria-selected")).toBe("true");
    press("ArrowDown");
    press("ArrowDown");
    expect(active()).toBe(options()[2].id);
    press("ArrowDown");
    expect(active()).toBe(options()[0].id);
    press("ArrowUp");
    expect(active()).toBe(options()[2].id);
  });

  it("Enter picks the highlighted option instead of submitting the form", () => {
    mount();
    press("ArrowDown");
    press("ArrowDown");
    pressEnter();
    expect(picked).toEqual(["BRN"]);
    expect(submits).toBe(0);
  });

  it("Enter with nothing highlighted submits the form as before", () => {
    mount();
    pressEnter();
    expect(picked).toEqual([]);
    expect(submits).toBe(1);
  });

  it("clicking picks, without taking focus from the field", () => {
    mount();
    const option = options()[2];
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    act(() => option.dispatchEvent(down));
    expect(down.defaultPrevented).toBe(true);
    act(() => option.click());
    expect(picked).toEqual(["GBR"]);
  });

  it("Escape closes the list; typing or Down brings it back", () => {
    mount();
    press("Escape");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    act(() => vi.advanceTimersByTime(SUGGEST_EXIT_MS));
    expect(list()).toBeNull();
    press("ArrowDown");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(input().getAttribute("aria-activedescendant")).toBe(options()[0].id);
  });

  it("a new list clears the highlight", () => {
    mount();
    press("ArrowDown");
    act(() => setOptions([OPTIONS[1]]));
    expect(input().getAttribute("aria-activedescendant")).toBeNull();
  });

  it("plays an exit before unmounting, and the closing list can't be clicked", () => {
    mount();
    act(() => setOptions([]));
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(list()!.classList.contains("clay-suggest--closing")).toBe(true);
    expect(list()!.getAttribute("aria-hidden")).toBe("true");
    expect(options().map((o) => o.textContent)).toEqual(["Brazil", "Brunei", "United Kingdomas Britain"]);
    act(() => options()[0].click());
    expect(picked).toEqual([]);
    act(() => vi.advanceTimersByTime(SUGGEST_EXIT_MS));
    expect(list()).toBeNull();
  });

  it("reopening during the exit cancels it", () => {
    mount();
    act(() => setOptions([]));
    act(() => setOptions([OPTIONS[0]]));
    act(() => vi.advanceTimersByTime(SUGGEST_EXIT_MS));
    expect(list()!.classList.contains("clay-suggest--closing")).toBe(false);
    expect(options().map((o) => o.textContent)).toEqual(["Brazil"]);
  });

  it("closes when the field loses focus", () => {
    mount();
    act(() => input().blur());
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });
});
