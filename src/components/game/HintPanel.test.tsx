// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startingLetters } from "@/utils/hintTally";
import HintPanel, { HintTally, letterCount, letterPattern, MAX_HINTS, type Hint } from "./HintPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("letterPattern", () => {
  it.each([
    ["Brazil", "B _ _ _ _ _"],
    ["Chad", "C _ _ _"],
    ["Burkina Faso", "B _ _ _ _ _ _   _ _ _ _"],
    ["Guinea-Bissau", "G _ _ _ _ _ - _ _ _ _ _ _"],
    ["São Tomé and Príncipe", "S _ _   _ _ _ _   _ _ _   _ _ _ _ _ _ _ _"],
    ["Côte d'Ivoire", "C _ _ _   _ ' _ _ _ _ _ _"],
    ["  Kenya ", "K _ _ _ _"],
  ])("%s -> %s", (name, pattern) => {
    expect(letterPattern(name)).toBe(pattern);
  });

  it("only gives away the first letter, upper-cased", () => {
    expect(letterPattern("ottawa")).toBe("O _ _ _ _ _");
  });
});

describe("letterCount", () => {
  it("counts letters only", () => {
    expect(letterCount("Brazil")).toBe(6);
    expect(letterCount("Guinea-Bissau")).toBe(12);
    expect(letterCount("São Tomé and Príncipe")).toBe(18);
  });
});

describe("HintTally", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  const show = (names: string[]) =>
    act(() => root.render(<HintTally label="Remaining starting letters" items={startingLetters(names)} />));
  const chips = () => [...container.querySelectorAll(".hint-tally__item")];

  it("reads as one line, with a chip per letter", () => {
    show(["Malta", "Togo", "Mali", "Chad", "Mongolia"]);
    expect(container.textContent).toBe("Remaining starting letters: M (3), C (1), T (1)");
    expect(chips()).toHaveLength(3);
    expect(container.querySelector(".hint-tally")!.getAttribute("aria-live")).toBe("off"); // count changes aren't announced
  });

  it("re-renders only the chip whose count changed (it springs back in), and drops a letter at zero", () => {
    show(["Malta", "Togo", "Mali", "Mongolia", "Chad"]);
    const [m, c, t] = chips();
    show(["Malta", "Togo", "Mongolia", "Chad"]); // Mali named
    const after = chips();
    expect(container.textContent).toBe("Remaining starting letters: M (2), C (1), T (1)");
    expect(after[0]).not.toBe(m); // M (2): a new node, so its pop-in plays
    expect(after[1]).toBe(c);
    expect(after[2]).toBe(t);
    show(["Malta", "Mongolia", "Chad"]); // Togo named
    expect(container.textContent).toBe("Remaining starting letters: M (2), C (1)");
  });
});

describe("HintPanel", () => {
  let container: HTMLDivElement;
  let root: Root;
  const hints: Hint[] = [
    { name: "Capital City", shown: "One missing country has the capital Nairobi." },
    { name: "First Letter", shown: "K _ _ _ _" },
  ];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = (used: number, onRequest = vi.fn(), available = true) =>
    act(() => root.render(<HintPanel used={used} hints={hints} lead="Two hints per round." available={available} onRequest={onRequest} />));
  const button = () => container.querySelector("button")!;

  it("has two hints per round", () => {
    expect(MAX_HINTS).toBe(2);
  });

  it("names the next hint on its button, and shows the lead before any hint", () => {
    const onRequest = vi.fn();
    render(0, onRequest);
    expect(button().textContent).toBe("Capital City (0/2)");
    expect(container.querySelector(".card-lead")!.textContent).toBe("Two hints per round.");
    act(() => button().click());
    expect(onRequest).toHaveBeenCalledTimes(1);
  });

  it("lists the hints given so far, in order", () => {
    render(1);
    expect(button().textContent).toBe("First Letter (1/2)");
    expect([...container.querySelectorAll(".hint-name")].map((n) => n.textContent)).toEqual(["Capital City"]);
    render(2);
    expect(button().textContent).toBe("No hints left (2/2)");
    expect(button().disabled).toBe(true);
    expect([...container.querySelectorAll(".hint-text")].map((n) => n.textContent)).toEqual([
      "One missing country has the capital Nairobi.",
      "K _ _ _ _",
    ]);
  });

  it("is disabled when there's nothing to hint at", () => {
    render(0, vi.fn(), false);
    expect(button().disabled).toBe(true);
  });
});
