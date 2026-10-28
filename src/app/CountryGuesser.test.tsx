// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "@/data/countries.json";
import { resolveEmpires, toSovereignStates, type RawCountry } from "@/data/loadCountries";
import CountryGuesser, { initialSession, sessionReducer, TYPO_ACCEPT_DELAY_MS, type Guess } from "./CountryGuesser";
import { buildBorderGraph, pickRoute } from "@/utils/pathfinding";
import { dailyChallenge, dateKey } from "@/utils/dailySeed";
import { isLocalOnly, QR_EXIT_MS } from "@/components/game/QrShareModal";
import { SPLASH_EXIT_MS } from "@/components/game/SplashScreen";
import { CONTINENTS, LOGO_SRC } from "./CountryGuesser";

// Count ClayCard renders: ClayCard is a plain child of CountryGuesser, so it
// re-renders exactly when CountryGuesser does. Used to prove timer ticks don't.
const renders = vi.hoisted(() => ({ clayCard: 0 }));
// The page's query string, as useSearchParams sees it.
const search = vi.hoisted(() => ({ params: new URLSearchParams() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => search.params }));
vi.mock("@/components/ui/ClayCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/ClayCard")>();
  return {
    default: (props: Parameters<typeof actual.default>[0]) => {
      renders.clayCard++;
      return actual.default(props);
    },
  };
});

// Record what Save Score asks the card renderer to draw (it still runs for real).
const scoreCards = vi.hoisted(() => ({ inputs: [] as unknown[] }));
vi.mock("@/utils/scoreCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/scoreCard")>();
  return {
    ...actual,
    renderScoreCard: (input: Parameters<typeof actual.renderScoreCard>[0]) => {
      scoreCards.inputs.push(input);
      return actual.renderScoreCard(input);
    },
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const countries = toSovereignStates(snapshot as RawCountry[]);
const empires = resolveEmpires(countries);
const inRegion = (r: string) => countries.filter((c) => c.region === r);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CountryGuesser countries={countries} empires={empires} showSplash={false} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const input = () => $<HTMLInputElement>("input")!;
const feedback = () => $(".feedback-region")?.textContent?.trim() ?? "";
const chipNames = () => [...container.querySelectorAll(".raw-list:not(.missed-list) .chip-name")].map((e) => e.textContent);
const counter = () => `${$(".counter-value")!.textContent} ${$(".counter-total")!.textContent}`;
const timer = () => $("[role=timer]")!.textContent;
const clickButton = (label: string) => {
  const button = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`No button "${label}"`);
  act(() => button.click());
};
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));

/** Types like a person: one character per input event, appending to whatever is in the field. */
function typeKeys(text: string) {
  const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (const ch of text) {
    act(() => {
      setNative.call(input(), input().value + ch);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}
const pressEnter = () => act(() => $<HTMLButtonElement>("button[type=submit]")!.click());

describe("setup", () => {
  it("offers each continent with its country count, and no timer yet", () => {
    const labels = [...container.querySelectorAll(".continent-button")].map((b) => b.textContent);
    expect(labels).toEqual([
      "Africa54 countries",
      "Americas35 countries",
      "Asia47 countries",
      "Europe45 countries",
      "Oceania14 countries",
    ]);
    expect($("[role=timer]")).toBeNull();
    expect($("input")).toBeNull();
  });

  it("picking a continent filters the targets and starts the timer", () => {
    clickButton("Africa");
    expect($("h1")!.textContent).toBe("Africa");
    expect(counter()).toBe("0 / 54");
    expect(timer()).toBe("00:00");
    wait(65_000);
    expect(timer()).toBe("01:05");
  });
});

describe("live typing", () => {
  beforeEach(() => clickButton("Africa"));

  it("adds a correctly typed country on the last keystroke, with no Enter, and clears the field", () => {
    typeKeys("Kenya");
    expect(chipNames()).toEqual(["Kenya"]);
    expect(input().value).toBe("");
    expect(counter()).toBe("1 / 54");
    expect(feedback()).toBe("Recognized: Kenya");
  });

  it("replays the press animation on each accepted answer", () => {
    expect(input().getAttribute("data-press")).toBeNull();
    typeKeys("Kenya");
    expect(input().getAttribute("data-press")).toBe("a");
    typeKeys("Ghana");
    expect(input().getAttribute("data-press")).toBe("b");
  });

  it("does not credit Niger while the player is typing Nigeria", () => {
    typeKeys("Nigeria");
    expect(chipNames()).toEqual(["Nigeria"]);
  });

  it("holds an exact name that starts another country, and Enter adds it", () => {
    typeKeys("Niger");
    expect(chipNames()).toEqual([]);
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    expect(feedback()).toBe("Niger: press Enter to add it, or keep typing.");
    pressEnter();
    expect(chipNames()).toEqual(["Niger"]);
  });

  it("accepts a typo-corrected name once typing pauses", () => {
    typeKeys("Kneya");
    expect(chipNames()).toEqual([]);
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    expect(chipNames()).toEqual(["Kenya"]);
    expect(feedback()).toBe('Recognized: Kenya (from "Kneya", 1 edit away)');
  });

  it("does not accept a typo while the player keeps typing", () => {
    typeKeys("Kney");
    wait(TYPO_ACCEPT_DELAY_MS - 200);
    typeKeys("a");
    wait(TYPO_ACCEPT_DELAY_MS - 200);
    expect(chipNames()).toEqual([]);
  });

  it("tells the player a country is outside the round on Enter", () => {
    typeKeys("France");
    expect(chipNames()).toEqual([]);
    pressEnter();
    expect(feedback()).toBe("France isn't in Africa.");
  });

  it("says when a country is already named, without counting it twice", () => {
    typeKeys("Kenya");
    typeKeys("Kenya");
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    expect(feedback()).toBe("Kenya is already on your list.");
    expect(counter()).toBe("1 / 54");
  });
});

describe("ending a round", () => {
  it("wins when every country is named: timer stops and the time is shown", () => {
    clickButton("Oceania");
    wait(30_000);
    for (const c of inRegion("Oceania")) {
      typeKeys(c.name);
      wait(TYPO_ACCEPT_DELAY_MS + 50); // names like "Micronesia" start a longer alias, so they land after the pause
    }
    expect($("#result-heading")!.textContent).toBe("All 14 named");
    expect(document.activeElement).toBe($("#result-heading"));
    const frozen = timer();
    wait(60_000);
    expect(timer()).toBe(frozen);
    expect($(".card-lead")!.textContent).toBe(`Every country in Oceania, in ${frozen}, with no hints.`);
    expect($("input")).toBeNull();
  });

  it("forfeit stops the timer and lists what was missed", () => {
    clickButton("Oceania");
    typeKeys("Fiji");
    typeKeys("Tonga");
    wait(42_000);
    clickButton("Forfeit");
    expect($("#result-heading")!.textContent).toBe("2 of 14 named");
    expect(timer()).toBe("00:42");
    expect($(".card-lead")!.textContent).toBe("You forfeited at 00:42, with no hints. Here are the 12 you missed.");
    const missed = [...container.querySelectorAll(".missed-list .chip-name")].map((e) => e.textContent);
    expect(missed).toHaveLength(12);
    expect(missed).not.toContain("Fiji");
  });

  it("can replay the same continent from 00:00, or go back to setup", () => {
    clickButton("Oceania");
    typeKeys("Fiji");
    wait(10_000);
    clickButton("Forfeit");
    clickButton("Play Oceania again");
    expect(timer()).toBe("00:00");
    expect(counter()).toBe("0 / 14");
    clickButton("Forfeit");
    clickButton("Choose another round");
    expect(container.querySelectorAll(".continent-button")).toHaveLength(5);
  });
});

/** The map loads lazily; wait for its chunk and the re-render. */
async function loadMap() {
  await act(async () => {
    await import("@/components/game/SvgMap");
  });
  await act(async () => {});
}
const hintButton = () => [...container.querySelectorAll("button")].find((b) => /hint/i.test(b.textContent ?? ""))!;
const hints = () => [...container.querySelectorAll(".hint-list > .hint")].map((li) => li.textContent?.trim() ?? "");
const byCode = new Map(countries.map((c) => [c.code, c]));

describe("hints", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    clickButton("Europe");
  });
  afterEach(() => vi.restoreAllMocks());

  it("starts with 0 of 3 used", () => {
    expect(hintButton().textContent).toBe("Get a hint (0/3)");
    expect(hints()).toEqual([]);
  });

  it("stage 1 names the land neighbours of one missing country; stage 2 pulses that country", async () => {
    await loadMap();
    clickButton("Get a hint");
    expect(hintButton().textContent).toBe("Get a hint (1/3)");
    expect(hints()[0]).toMatch(/^A missing country borders .+\.$/);
    clickButton("Get a hint");
    expect(hints()[1]).toBe("Its outline is pulsing on the map.");
    const hinted = byCode.get($(".map-hint")!.getAttribute("data-code")!)!;
    const neighbourNames = hinted.borders.flatMap((b) => byCode.get(b)?.name ?? []);
    for (const name of neighbourNames) expect(hints()[0]).toContain(name);
  });

  it("stage 3 lists the initials of every missing country and updates as you play", () => {
    clickButton("Get a hint");
    clickButton("Get a hint");
    clickButton("Get a hint");
    expect(container.querySelectorAll(".initial")).toHaveLength(45);
    typeKeys("France");
    expect(container.querySelectorAll(".initial")).toHaveLength(44);
    expect(hintButton().textContent).toBe("No hints left (3/3)");
    expect(hintButton().disabled).toBe(true);
  });

  it("naming the hinted country confirms it and stops the pulse", async () => {
    await loadMap();
    clickButton("Get a hint");
    clickButton("Get a hint");
    const hinted = byCode.get($(".map-hint")!.getAttribute("data-code")!)!;
    typeKeys(hinted.name);
    if (input().value) pressEnter(); // a name that starts another country's waits for Enter
    expect(hints()[0]).toContain(`You found it: ${hinted.name}.`);
    expect($(".map-hint")).toBeNull();
    expect($(`.map-named[data-code="${hinted.code}"]`)).not.toBeNull();
  });

  it("reports hints used in the result", () => {
    clickButton("Get a hint");
    clickButton("Forfeit");
    expect($(".card-lead")!.textContent).toBe("You forfeited at 00:00, with 1 hint. Here are the 45 you missed.");
  });
});

describe("map in the game", () => {
  it("fills each named country on the map", async () => {
    clickButton("Europe");
    await loadMap();
    expect($(".world-map")!.getAttribute("aria-label")).toBe("Map of Europe: 0 of 45 countries named");
    typeKeys("France");
    expect($('.map-named[data-code="FRA"]')).not.toBeNull();
    expect($(".world-map")!.getAttribute("aria-label")).toBe("Map of Europe: 1 of 45 countries named");
  });
});

describe("Historical Mode", () => {
  const empireTiles = () => [...container.querySelectorAll(".continent-button")].map((b) => b.textContent);

  it("the mode switch shows the 5 empires with their eras and country counts", () => {
    clickButton("Empires");
    expect($(".mode-option[aria-pressed=true]")!.textContent).toBe("Empires");
    expect($("#setup-heading")!.textContent).toBe("Pick an empire");
    expect(empireTiles()).toEqual([
      "Roman Empire27 BC – AD 47643 countries",
      "Mughal Empire1526 – 18574 countries",
      "Ottoman Empire1299 – 192238 countries",
      "Soviet Union1922 – 199115 countries",
      "British Empire1583 – 199766 countries",
    ]);
  });

  it("an empire round targets only that empire's countries", () => {
    clickButton("Empires");
    clickButton("Mughal Empire");
    expect($("h1")!.textContent).toBe("Mughal Empire");
    expect(counter()).toBe("0 / 4");
    typeKeys("Pakistan");
    expect(chipNames()).toEqual(["Pakistan"]);
    typeKeys("Nepal");
    pressEnter();
    expect(feedback()).toBe("Nepal isn't on the Mughal Empire list.");
  });

  it("chips and map take the empire's color theme", async () => {
    clickButton("Empires");
    clickButton("Soviet Union");
    await loadMap();
    typeKeys("Estonia");
    expect($('section[aria-labelledby="named-heading"]')!.getAttribute("data-theme")).toBe("Soviet");
    expect($(".chip")!.hasAttribute("data-region")).toBe(false);
    expect($(".world-map")!.getAttribute("data-theme")).toBe("Soviet");
    expect($(".world-map")!.getAttribute("aria-label")).toBe("Map of Soviet Union: 1 of 15 countries named");
  });

  it("winning an empire round reports it, and setup reopens on the Empires tab", () => {
    clickButton("Empires");
    clickButton("Mughal Empire");
    for (const name of ["India", "Pakistan", "Bangladesh", "Afghanistan"]) typeKeys(name);
    expect($("#result-heading")!.textContent).toBe("All 4 named");
    expect($(".card-lead")!.textContent).toMatch(/^Every modern country on the Mughal Empire list, in \d\d:\d\d, with no hints\.$/);
    clickButton("Choose another round");
    expect($(".mode-option[aria-pressed=true]")!.textContent).toBe("Empires");
  });
});

describe("World Mode", () => {
  it("targets all 195 countries and colors each by its continent", async () => {
    clickButton("World");
    clickButton("Start");
    expect($("h1")!.textContent).toBe("World");
    expect(counter()).toBe("0 / 195");
    await loadMap();
    typeKeys("Kenya");
    typeKeys("Japan");
    expect([...container.querySelectorAll(".chip")].map((c) => c.getAttribute("data-region"))).toEqual(["Africa", "Asia"]);
    expect($(".world-map")!.hasAttribute("data-theme")).toBe(false);
    expect($('.map-named[data-code="KEN"]')!.getAttribute("data-region")).toBe("Africa");
  });
});

describe("Pathfinding", () => {
  const graph = buildBorderGraph(countries);
  // With Math.random() pinned to 0 the game picks this exact puzzle.
  const puzzle = pickRoute(graph, { random: () => 0 })!;
  const name = (code: string) => byCode.get(code)!.name;
  const prompt = () => $(".route-prompt")!.textContent;
  const routeChips = () => [...container.querySelectorAll(".route-list .chip-name")].map((e) => e.textContent);
  const moves = () => `${$(".counter-value")!.textContent} ${$(".counter-total")!.textContent}`;
  /** Type a country; names that start another country's wait for Enter, as in play. */
  const step = (code: string) => {
    typeKeys(name(code));
    if ($<HTMLInputElement>("input")?.value) pressEnter(); // the field is gone once the route is complete
  };

  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    clickButton("Pathfinding");
  });
  afterEach(() => vi.restoreAllMocks());

  it("offers a random route from the setup screen", () => {
    expect($("#setup-heading")!.textContent).toBe("Find a land route");
    expect($(".continent-button")!.textContent).toBe("StartRandom route, 3–7 countries apart");
  });

  it("starts at the start country with 0 moves, the route listed, and no hint panel", () => {
    clickButton("Start");
    expect($("h1")!.textContent).toBe(`${name(puzzle.start)} to ${name(puzzle.end)}`);
    expect(moves()).toBe("0 moves");
    expect(prompt()).toBe(`You're in ${name(puzzle.start)}. Name a country that borders it.`);
    expect(routeChips()).toEqual([name(puzzle.start), name(puzzle.end)]);
    expect(hintButton()).toBeUndefined();
  });

  it("accepts a bordering country as you type and moves you there", () => {
    clickButton("Start");
    step(puzzle.shortest[1]);
    expect(moves()).toBe("1 move");
    expect(prompt()).toBe(`You're in ${name(puzzle.shortest[1])}. Name a country that borders it.`);
    expect(routeChips()).toEqual([name(puzzle.start), name(puzzle.shortest[1]), name(puzzle.end)]);
  });

  it("rejects a country that doesn't border where you are", () => {
    clickButton("Start");
    const notNeighbour = countries.find((c) => c.code !== puzzle.start && !graph.get(puzzle.start)!.has(c.code) && c.name.length > 5)!;
    typeKeys(notNeighbour.name);
    pressEnter();
    expect(feedback()).toBe(`${notNeighbour.name} doesn't border ${name(puzzle.start)}.`);
    expect(moves()).toBe("0 moves");
  });

  it("says when you name the country you're already in", () => {
    clickButton("Start");
    typeKeys(name(puzzle.start));
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    expect(feedback()).toBe(`You're already in ${name(puzzle.start)}.`);
  });

  it("stepping back cuts the route but still counts the move", () => {
    clickButton("Start");
    step(puzzle.shortest[1]);
    step(puzzle.start);
    expect(feedback()).toBe(`Back to ${name(puzzle.start)}.`);
    expect(routeChips()).toEqual([name(puzzle.start), name(puzzle.end)]);
    expect(moves()).toBe("2 moves");
  });

  it("completes when the route touches the destination, and reports par", async () => {
    clickButton("Start");
    await loadMap();
    expect($(`.map-endpoint--start[data-code="${puzzle.start}"]`)).not.toBeNull();
    expect($(`.map-endpoint--end[data-code="${puzzle.end}"]`)).not.toBeNull();
    for (const code of puzzle.shortest.slice(1, -1)) step(code);
    expect($("#result-heading")!.textContent).toBe(`You reached ${name(puzzle.end)}`);
    expect($(".card-lead")!.textContent).toMatch(
      new RegExp(`in ${puzzle.par} moves, \\d\\d:\\d\\d\\. The shortest route has ${puzzle.par} countries in between\\.$`),
    );
    expect($(".map-endpoint--end")!.classList.contains("map-endpoint--reached")).toBe(true);
    for (const code of puzzle.shortest.slice(1, -1)) expect($(`.map-named[data-code="${code}"]`)).not.toBeNull();
  });

  it("has Give Up under the map instead of Forfeit, only while the route is on", () => {
    clickButton("Start");
    const buttons = () => [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons()).not.toContain("Forfeit");
    const giveUp = [...container.querySelectorAll<HTMLButtonElement>(".map-card button")].find((b) => b.textContent === "Give Up")!;
    expect(giveUp.classList.contains("give-up")).toBe(true);
    clickButton("Give Up");
    expect(buttons()).not.toContain("Give Up");
  });

  it("Give Up stops the clock and ends the route, showing one shortest route", () => {
    clickButton("Start");
    wait(5_000);
    clickButton("Give Up");
    expect($("#result-heading")!.textContent).toBe("Route abandoned");
    const stopped = timer();
    expect(stopped).toBe("00:05");
    wait(10_000);
    expect(timer()).toBe(stopped);
    expect([...container.querySelectorAll('[aria-label="One shortest route"] .chip-name')].map((e) => e.textContent)).toEqual(
      puzzle.shortest.slice(1, -1).map(name),
    );
    expect($("input")).toBeNull();
  });

  it("Give Up shows the route's unreached countries in red on the map", async () => {
    clickButton("Start");
    await loadMap();
    step(puzzle.shortest[1]); // one step along the shortest route
    expect(container.querySelector(".map-named--missed, .map-marker--missed")).toBeNull();
    clickButton("Give Up");
    const red = (code: string) => container.querySelector(`.map-named--missed[data-code="${code}"], .map-marker--missed[data-code="${code}"]`);
    const rest = puzzle.shortest.slice(2, -1);
    for (const code of rest) expect(red(code)).not.toBeNull();
    expect(red(puzzle.shortest[1])).toBeNull(); // reached: not red
    expect($(".map-note--missed")!.textContent).toBe("In red: the rest of one shortest route.");
    expect($(".world-map")!.getAttribute("aria-label")).toMatch(
      new RegExp(`In red, the ${rest.length} countr(y|ies) of one shortest route you didn't reach\\.$`),
    );
  });

  it("Generate New Route, next to Share via QR, starts another route straight away", () => {
    clickButton("Start");
    clickButton("Give Up");
    const row = [...container.querySelectorAll(".route-next__buttons button")].map((b) => b.textContent);
    expect(row).toEqual(["Generate New Route", "Share via QR"]);
    expect(container.textContent).not.toContain("New route");
    clickButton("Generate New Route");
    expect($("#setup-heading")).toBeNull(); // no trip back to the menu
    expect(moves()).toBe("0 moves");
    expect(timer()).toBe("00:00");
    expect($<HTMLInputElement>("input")).not.toBeNull();
  });
});

describe("autocomplete", () => {
  const suggestions = () =>
    [...container.querySelectorAll('[role=listbox]:not([aria-hidden]) .clay-suggest__label')].map((e) => e.textContent);
  const optionNamed = (name: string) =>
    [...container.querySelectorAll<HTMLElement>("[role=option]")].find((o) => o.querySelector(".clay-suggest__label")!.textContent === name)!;
  const key = (k: string) =>
    act(() => {
      input().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });
  const setValue = (text: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(), text);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });

  it("searches all 195 countries, whatever the round, so it never narrows down the answers", () => {
    clickButton("Europe");
    typeKeys("b");
    expect(suggestions()).toEqual(["Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin"]);
    typeKeys("e");
    expect(suggestions()).toEqual(["Belarus", "Belgium", "Belize", "Benin", "Palau"]); // Palau as "Belau"
  });

  it("keeps countries in the list after they're named", () => {
    clickButton("Europe");
    typeKeys("Belgium");
    expect(chipNames()).toEqual(["Belgium"]);
    typeKeys("bel");
    expect(suggestions()).toEqual(["Belarus", "Belgium", "Belize", "Palau"]);
  });

  it("a clicked suggestion is accepted at once, with no typo pause", () => {
    clickButton("Africa");
    typeKeys("Niger"); // held: could still become Nigeria
    expect(suggestions()).toEqual(["Niger", "Nigeria"]);
    act(() => optionNamed("Nigeria").click());
    expect(chipNames()).toEqual(["Nigeria"]);
    expect(feedback()).toBe("Recognized: Nigeria");
    expect(input().value).toBe("");
    expect(container.querySelector(".clay-suggest:not(.clay-suggest--closing)")).toBeNull();
  });

  it("picking a country outside the round explains why, and closes the list so it can be read", () => {
    clickButton("Europe");
    typeKeys("bra");
    act(() => optionNamed("Brazil").click());
    expect(chipNames()).toEqual([]);
    expect(feedback()).toBe("Brazil isn't in Europe.");
    expect(suggestions()).toEqual([]);
    typeKeys("z"); // typing again brings the list back
    expect(suggestions()).toEqual(["Brazil", "Congo"]); // Congo as Congo-Brazzaville
  });

  it("picking a country that's already named says so", () => {
    clickButton("Europe");
    typeKeys("Belgium");
    typeKeys("belg");
    act(() => optionNamed("Belgium").click());
    expect(chipNames()).toEqual(["Belgium"]);
    expect(feedback()).toBe("Belgium is already on your list.");
  });

  it("arrow keys and Enter pick a suggestion", () => {
    clickButton("Africa");
    typeKeys("ken");
    key("ArrowDown");
    key("Enter");
    expect(chipNames()).toEqual(["Kenya"]);
  });

  it("explains alternate-name matches", () => {
    clickButton("Asia");
    typeKeys("bur");
    expect(optionNamed("Myanmar").textContent).toBe("Myanmaras Burma");
  });

  it("in a route, doesn't give away the neighbours, and a far-off pick is explained", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    clickButton("Pathfinding");
    clickButton("Start");
    const here = $(".route-prompt strong")!.textContent!;
    const country = countries.find((c) => c.name === here)!;
    const neighbours = buildBorderGraph(countries).get(country.code)!;
    const offered = new Set<string>();
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      setValue(letter);
      for (const name of suggestions()) offered.add(name!);
    }
    expect(offered.size).toBeGreaterThan(neighbours.size * 10);
    const far = [...offered].find((name) => !neighbours.has(countries.find((c) => c.name === name)!.code) && name !== here)!;
    setValue(far.slice(0, 4));
    act(() => optionNamed(far).click());
    expect(feedback()).toBe(`${far} doesn't border ${here}.`);
    vi.restoreAllMocks();
  });

  it("the Suggestions toggle hides the list", () => {
    clickButton("Europe");
    clickButton("Suggestions");
    typeKeys("bel");
    expect(container.querySelector("[role=listbox]")).toBeNull();
    expect(input().getAttribute("role")).toBeNull();
    clickButton("Suggestions");
    expect(suggestions()).toEqual(["Belarus", "Belgium", "Belize", "Palau"]);
  });
});

describe("Capitals mode", () => {
  beforeEach(() => clickButton("Capitals"));

  it("the setup modifier switches every list round to capitals", () => {
    expect($(".continent-button")!.textContent).toBe("Africa54 capitals");
    clickButton("Empires");
    expect($(".continent-button[data-theme]")!.textContent).toMatch(/capitals$/);
    clickButton("Continents");
    clickButton("Europe");
    expect($("h1")!.textContent).toBe("Europe capitals");
    expect(input().placeholder).toBe("Type a capital");
  });

  it("matches capitals, not country names, and shows each with its country", () => {
    clickButton("Europe");
    typeKeys("Paris");
    expect(feedback()).toBe("Recognized: Paris, capital of France");
    expect($(".raw-list .chip-name")!.textContent).toBe("Paris");
    expect($(".raw-list .chip-code")!.textContent).toBe("France");
    expect(counter()).toBe("1 / 45");
  });

  it("forgives typos and accepts other spellings of a capital", () => {
    clickButton("Europe");
    typeKeys("Kiev");
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    typeKeys("Lisbn");
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    expect(chipNames()).toEqual(["Kyiv", "Lisbon"]);
  });

  it("accepts any of a country's capitals, and shows the one given", () => {
    clickButton("Africa");
    typeKeys("Cape Town");
    expect(chipNames()).toEqual(["Cape Town"]);
    typeKeys("Pretoria");
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    expect(feedback()).toBe("Pretoria is already on your list.");
  });

  it("explains a capital from outside the round", () => {
    clickButton("Europe");
    typeKeys("Brasilia");
    wait(TYPO_ACCEPT_DELAY_MS + 50);
    expect(feedback()).toBe("Brasília is the capital of Brazil. Brazil isn't in Europe.");
  });

  it("nudges the player who types a country instead of its capital", () => {
    clickButton("Europe");
    typeKeys("Sweden");
    pressEnter();
    expect(feedback()).toBe("Sweden is a country. Name its capital.");
    expect(chipNames()).toEqual([]);
  });

  it("suggests capitals from the whole world", () => {
    clickButton("Oceania");
    typeKeys("ca");
    expect([...container.querySelectorAll(".clay-suggest__label")].map((e) => e.textContent)).toEqual([
      "Cairo",
      "Canberra",
      "Cape Town",
      "Caracas",
      "Castries",
    ]);
  });

  it("hints give the initials of missing capitals", () => {
    clickButton("Oceania");
    for (let i = 0; i < 3; i++) act(() => hintButton().click());
    const initials = [...container.querySelectorAll(".initial")].map((e) => e.textContent);
    expect(initials).toContain("C."); // Canberra
    expect(initials).toContain("P. M."); // Port Moresby
    expect(hints()[2]).toMatch(/^Initials of the 14 capitals still missing:/);
  });

  it("lists missed capitals with their countries after a forfeit, and replays in Capitals mode", () => {
    clickButton("Oceania");
    clickButton("Forfeit");
    const missed = [...container.querySelectorAll(".missed-list .chip")].map((e) => e.textContent);
    expect(missed).toContain("CanberraAustralia");
    clickButton("Play Oceania capitals again");
    expect($("h1")!.textContent).toBe("Oceania capitals");
  });
});

describe("Daily Challenge", () => {
  /** Remounts the game as if opened at local noon on `date`. */
  function openOn(date: string) {
    act(() => root.unmount());
    const [y, m, d] = date.split("-").map(Number);
    vi.setSystemTime(new Date(y, m - 1, d, 12));
    root = createRoot(container);
    act(() => root.render(<CountryGuesser countries={countries} empires={empires} showSplash={false} />));
  }
  async function play() {
    await act(async () => {}); // the card checks the profile for today's result
    clickButton("Play today's challenge");
  }
  const graph = buildBorderGraph(countries);
  const nameOf = (code: string) => byCode.get(code)!.name;
  /** First date from Oct 2026 whose challenge is of the given kind. */
  function dateWith(kind: "pathfinding" | "continent") {
    for (let i = 0; ; i++) {
      const date = dateKey(new Date(2026, 9, 1 + i));
      if (dailyChallenge(date, graph, CONTINENTS).kind === kind) return date;
    }
  }

  it("shows today's challenge on the setup screen", async () => {
    openOn("2026-10-26");
    await act(async () => {});
    expect($("#daily-heading")!.textContent).toBe("Daily Challenge");
    expect($(".daily-card__date")!.textContent).toMatch(/October 26/);
  });

  it("starts the seeded route for that date", async () => {
    const date = dateWith("pathfinding");
    const challenge = dailyChallenge(date, graph, CONTINENTS);
    if (challenge.kind !== "pathfinding") throw new Error("unreachable");
    openOn(date);
    await play();
    expect($("h1")!.textContent).toBe(`${nameOf(challenge.puzzle.start)} to ${nameOf(challenge.puzzle.end)}Daily`);
    expect($(".daily-badge")!.textContent).toBe("Daily");
  });

  it("starts the seeded continent, in Countries mode even if Capitals is selected", async () => {
    const date = dateWith("continent");
    const challenge = dailyChallenge(date, graph, CONTINENTS);
    if (challenge.kind !== "continent") throw new Error("unreachable");
    openOn(date);
    clickButton("Capitals");
    await play();
    expect($("h1")!.textContent).toBe(`${challenge.continent}Daily`);
    expect(input().placeholder).toBe("Type a country");
  });

  it("shares a spoiler-free daily result", async () => {
    const date = dateWith("pathfinding");
    openOn(date);
    await play();
    wait(72_000);
    clickButton("Give Up");
    const text = $(".share-preview")!.textContent!;
    expect(text.split("\n")).toEqual([`geotag - Daily Pathfinding ${date}`, "🗺️ 🏳️ gave up after 0 moves ⏱️ 01:12"]);
    for (const c of countries) expect(text).not.toContain(c.name);
  });
});

describe("challenge links (?route=)", () => {
  /** Remounts the game as if opened from a link with this query string. */
  function openLink(query: string) {
    act(() => root.unmount());
    search.params = new URLSearchParams(query);
    window.history.replaceState(null, "", `/?${query}`);
    root = createRoot(container);
    act(() => root.render(<CountryGuesser countries={countries} empires={empires} showSplash={false} />));
  }
  afterEach(() => {
    search.params = new URLSearchParams();
    window.history.replaceState(null, "", "/");
  });
  const notice = () => $(".notice-card")?.textContent ?? "";

  it("skips the setup screen and starts the linked route", () => {
    openLink("route=FRA-CHN");
    expect($("h1")!.textContent).toBe("France to China");
    expect($(".route-prompt")!.textContent).toBe("You're in France. Name a country that borders it.");
    expect($(".continent-grid")).toBeNull();
    expect(window.location.search).toBe(""); // a reload won't relaunch it
  });

  it("accepts lowercase codes", () => {
    openLink("route=prt-pol");
    expect($("h1")!.textContent).toBe("Portugal to Poland");
  });

  it("plays the linked route through to the end", () => {
    openLink("route=PRT-POL");
    for (const name of ["Spain", "France", "Germany"]) typeKeys(name);
    expect($("#result-heading")!.textContent).toBe("You reached Poland");
  });

  it.each([
    ["route=XXX-CHN", "XXX isn't a code for one of the game's 195 countries."],
    ["route=FRA-USA", "There's no land route from France to United States."],
    ["route=FRA-FRA", "The route starts and ends in France."],
    ["route=FRA-DEU", "France and Germany share a border, so there's nothing to name in between."],
    ["route=FRANCE", `"FRANCE" isn't a route.`],
    ["route=", `"" isn't a route.`],
  ])("falls back to the setup screen for %s, saying why", (query, reason) => {
    openLink(query);
    expect($(".continent-grid")).not.toBeNull();
    expect($("[role=timer]")).toBeNull();
    expect(notice()).toContain("That challenge link didn't work");
    expect(notice()).toContain(reason);
  });

  it("ignores other query parameters", () => {
    openLink("utm_source=nfc");
    expect($(".continent-grid")).not.toBeNull();
    expect(notice()).toBe("");
  });

  it("the notice can be dismissed, and starting a round clears it", () => {
    openLink("route=XXX-YYY");
    clickButton("Dismiss");
    expect(notice()).toBe("");
    openLink("route=XXX-YYY");
    clickButton("Europe");
    clickButton("Forfeit");
    clickButton("Choose another round");
    expect(notice()).toBe("");
  });

  it("Share via QR opens a modal whose code holds the exact route link", async () => {
    openLink("route=FRA-CHN");
    clickButton("Give Up");
    expect(container.textContent).not.toContain("Create NFC Challenge");
    await act(async () => {
      await import("@/components/game/QrShareModal");
    });
    clickButton("Share via QR");
    await act(async () => {});
    const dialog = $<HTMLDialogElement>("dialog.qr-dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe("qr-heading");
    const link = `${window.location.origin}/?route=FRA-CHN`;
    expect($(".qr-url")!.textContent).toBe(link);
    expect(dialog.querySelector("svg title")!.textContent).toBe(`QR code for ${link}`);
    // Light to draw: the whole code is one path (plus its white background).
    expect(dialog.querySelectorAll(".qr-face svg path").length).toBeLessThanOrEqual(2);
    expect($(".qr-modal .card-lead")!.textContent).toBe("France to China. Point another phone's camera at the code.");
  });

  it("the QR modal closes with its button, Escape or a backdrop click, after a short exit", async () => {
    openLink("route=FRA-CHN");
    clickButton("Give Up");
    await act(async () => {
      await import("@/components/game/QrShareModal");
    });
    const open = async () => {
      clickButton("Share via QR");
      await act(async () => {});
    };
    await open();
    const dialog = $<HTMLDialogElement>("dialog")!;
    clickButton("Close");
    expect(dialog.classList.contains("qr-dialog--closing")).toBe(true);
    expect(dialog.open).toBe(true); // still showing its exit
    wait(QR_EXIT_MS);
    expect(dialog.open).toBe(false); // closed before removal, so focus returns to the button
    expect($("dialog")).toBeNull();

    await open();
    act(() => {
      $("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    });
    wait(QR_EXIT_MS);
    expect($("dialog")).toBeNull();

    await open();
    act(() => $("dialog")!.click());
    wait(QR_EXIT_MS);
    expect($("dialog")).toBeNull();
  });

  it("a challenge result offers to play the route again", () => {
    openLink("route=FRA-CHN");
    clickButton("Give Up");
    expect($(".share-preview")!.textContent).toMatch(/^geotag - Pathfinding Challenge\n/);
    clickButton("Play this route again");
    expect($("h1")!.textContent).toBe("France to China");
  });

  it("random routes can be shared by QR too, and list rounds can't", () => {
    clickButton("Pathfinding");
    clickButton("Start");
    clickButton("Give Up");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Share via QR")).toBe(true);
    clickButton("Choose another round");
    clickButton("Continents");
    clickButton("Oceania");
    clickButton("Forfeit");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Share via QR")).toBe(false);
  });
});

describe("isLocalOnly (QR links another phone can't open)", () => {
  it.each([
    ["localhost", true],
    ["127.0.0.1", true],
    ["[::1]", true],
    ["0.0.0.0", true],
    ["192.168.1.20", false], // a LAN address works for phones on the same Wi-Fi
    ["geotag.vercel.app", false],
  ])("%s -> %s", (host, local) => {
    expect(isLocalOnly(host)).toBe(local);
  });
});

describe("Share Result", () => {
  const writeText = vi.fn<(text: string) => Promise<void>>();
  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("builds a pace grid for a name-them-all round and copies it", async () => {
    clickButton("Oceania");
    for (const name of ["Fiji", "Samoa", "Tonga", "Tuvalu", "Nauru", "Palau", "Kiribati"]) {
      wait(4_000);
      typeKeys(name);
    }
    wait(60_000);
    clickButton("Forfeit");
    const text = $(".share-preview")!.textContent!;
    // 14 countries in 10 squares: 7 named fills the first 5 (4 s each: green). Suggestions showed while typing.
    expect(text).toBe("geotag - Oceania\n🌏 7/14 🏳️ ⏱️ 01:28\n🟩🟩🟩🟩🟩⬜⬜⬜⬜⬜\n🔤 with suggestions");
    writeText.mockResolvedValue();
    await act(async () => clickButton("Share result"));
    expect(writeText).toHaveBeenCalledWith(text);
    expect($(".share-toast")!.textContent).toBe("Copied. Paste it anywhere.");
  });

  it("falls back to the visible text when the clipboard refuses", async () => {
    clickButton("Oceania");
    clickButton("Forfeit");
    writeText.mockRejectedValue(new Error("denied"));
    await act(async () => clickButton("Share result"));
    expect($(".share-toast--failed")!.textContent).toMatch(/^Couldn't reach the clipboard/);
    expect($(".share-preview")).not.toBeNull();
  });
});

describe("map taps", () => {
  const shape = (code: string) =>
    container.querySelector(`.world-map [data-code="${code}"][data-clickable], .world-map .map-country[data-code="${code}"]`)!;
  const tapMap = (code: string) =>
    act(() => {
      shape(code).dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 100 }));
    });
  const tooltip = () => $(".map-tip")?.textContent ?? null;
  const announced = () => $(".map-stage [aria-live]")!.textContent;
  const useAllHints = () => {
    for (let i = 0; i < 3; i++) act(() => hintButton().click());
  };

  it("is inert during a round until all three hints are used", async () => {
    clickButton("Oceania");
    await loadMap();
    act(() => hintButton().click());
    act(() => hintButton().click());
    expect(container.querySelector(".world-map [data-clickable]")).toBeNull();
    tapMap("PNG");
    expect(tooltip()).toBeNull();
    expect($(".map-note")).toBeNull();
  });

  it("after the third hint, a missing country shows only its initials", async () => {
    clickButton("Oceania");
    await loadMap();
    useAllHints();
    expect($(".map-note")!.textContent).toBe("Tap a missing country to see its initials.");
    expect(shape("PNG").getAttribute("data-clickable")).toBe("true");
    tapMap("PNG");
    expect(tooltip()).toBe("P. N. G.");
    expect(announced()).toBe("Initials: P. N. G.");
    expect($(".map-selected")).not.toBeNull();
  });

  it("shows a named country's full name, and ignores countries outside the round", async () => {
    clickButton("Oceania");
    await loadMap();
    useAllHints();
    typeKeys("Fiji");
    tapMap("FJI");
    expect(tooltip()).toBe("Fiji");
    expect(shape("IDN").hasAttribute("data-clickable")).toBe(false); // Indonesia is in frame but in Asia
    tapMap("IDN");
    expect(tooltip()).toBeNull();
  });

  it("stays up after the tap (no timeout), and closes on Escape, a tap outside, or a tap on the sea", async () => {
    clickButton("Oceania");
    await loadMap();
    useAllHints();
    tapMap("AUS");
    wait(10_000);
    expect(tooltip()).toBe("A.");
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(tooltip()).toBeNull();

    tapMap("AUS");
    act(() => {
      input().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    });
    expect(tooltip()).toBeNull();

    tapMap("AUS");
    act(() => {
      $(".world-map")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(tooltip()).toBeNull();
  });

  it("in Capitals mode, shows the initials of the capital", async () => {
    clickButton("Capitals");
    clickButton("Oceania");
    await loadMap();
    useAllHints();
    tapMap("AUS");
    expect(tooltip()).toBe("C."); // Canberra
    tapMap("PNG");
    expect(tooltip()).toBe("P. M."); // Port Moresby
  });

  it("after the round, any country shows its full name", async () => {
    clickButton("Oceania");
    await loadMap();
    clickButton("Forfeit");
    expect($(".map-note")!.textContent).toBe("Tap any country to see its name.");
    tapMap("PNG");
    expect(tooltip()).toBe("Papua New Guinea");
    tapMap("IDN"); // outside the round, but the round is over
    expect(tooltip()).toBe("Indonesia");
  });

  it("after a Capitals round, shows the name and the capital", async () => {
    clickButton("Capitals");
    clickButton("Africa");
    await loadMap();
    clickButton("Forfeit");
    tapMap("ZAF");
    expect(tooltip()).toBe("South AfricaCapitals: Pretoria, Bloemfontein, Cape Town"); // in the data's order
    tapMap("KEN");
    expect(tooltip()).toBe("KenyaCapital: Nairobi");
    expect(announced()).toBe("Kenya. Capital: Nairobi.");
  });

  it("a route's map is inert while playing (no hints there) and tappable once it ends", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    clickButton("Pathfinding");
    clickButton("Start");
    await loadMap();
    expect(container.querySelector(".world-map [data-clickable]")).toBeNull();
    clickButton("Give Up");
    const here = $(".map-endpoint--start")!.getAttribute("data-code")!;
    tapMap(here);
    expect(tooltip()).toBe(byCode.get(here)!.name);
    vi.restoreAllMocks();
  });

  it("a new round starts with the tooltip closed", async () => {
    clickButton("Oceania");
    await loadMap();
    clickButton("Forfeit");
    tapMap("AUS");
    expect(tooltip()).toBe("Australia");
    clickButton("Play Oceania again");
    await loadMap();
    expect(tooltip()).toBeNull();
  });
});

describe("boot-up splash and logo", () => {
  function mountWith(props: { showSplash?: boolean }) {
    act(() => root.unmount());
    root = createRoot(container);
    act(() =>
      root.render(<CountryGuesser countries={countries} empires={empires} {...props} />),
    );
  }
  const shell = () => $(".game-shell")!;
  const play = () => $<HTMLButtonElement>(".splash-play")!;
  const ready = async () => {
    await act(async () => {
      await import("@/components/game/SvgMap");
    });
    await act(async () => {});
  };

  it("covers the game on launch and keeps it inert until PLAY", async () => {
    mountWith({});
    expect($(".splash")).not.toBeNull();
    expect(shell().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe($("[role=dialog]")); // the dialog, not PLAY: no focus ring on load
    await ready();
    expect(play().getAttribute("data-ready")).toBe("true");
    act(() => play().click());
    // The exit plays; the game is live underneath and focus moves to its heading.
    expect($(".splash")!.classList.contains("splash--leaving")).toBe(true);
    expect(shell().hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe($("h1"));
    wait(SPLASH_EXIT_MS);
    expect($(".splash")).toBeNull();
    clickButton("Europe");
    expect($("h1")!.textContent).toBe("Europe");
  });

  it("a challenge link skips the splash", () => {
    act(() => root.unmount());
    search.params = new URLSearchParams("route=PRT-POL");
    root = createRoot(container);
    act(() => root.render(<CountryGuesser countries={countries} empires={empires} />));
    expect($(".splash")).toBeNull();
    expect(shell().hasAttribute("inert")).toBe(false);
    expect($("h1")!.textContent).toBe("Portugal to Poland");
    search.params = new URLSearchParams();
    window.history.replaceState(null, "", "/");
  });

  it("shows just the logo image in the header: the setup screen's heading, then above the round title", () => {
    mountWith({ showSplash: false });
    const heading = $("h1")!;
    const setupLogo = heading.querySelector<HTMLImageElement>("img.brand-logo")!;
    expect(setupLogo.getAttribute("src")).toBe(LOGO_SRC);
    expect(LOGO_SRC).toBe("/logo.png");
    expect(setupLogo.alt).toBe("geotag"); // the heading's name for screen readers
    // Nothing else in the heading: no wordmark, no clay badge around the logo.
    expect(heading.childElementCount).toBe(1);
    expect(heading.textContent).toBe("");
    expect(heading.parentElement!.nextElementSibling!.textContent).toBe("Name every country.");
    clickButton("Europe");
    const roundLogo = $<HTMLImageElement>(".brand-row > img.brand-logo")!;
    expect(roundLogo.getAttribute("src")).toBe("/logo.png");
    expect(roundLogo.parentElement!.nextElementSibling!.querySelector("h1")!.textContent).toBe("Europe");
    expect($(".brand")).toBeNull();
  });
});

describe("header: Profile & Stats", () => {
  const profileButton = () => $<HTMLButtonElement>(".header-actions .header-button");

  it("sits in the header, not among the game modes", () => {
    expect(profileButton()!.textContent).toBe("Profile & Stats");
    expect(profileButton()!.closest(".brand-row")).not.toBeNull();
    const modes = [...container.querySelectorAll(".mode-switch button")].map((b) => b.textContent);
    expect(modes).toEqual(["Continents", "Empires", "World", "Pathfinding"]);
  });

  it("opens the profile in a modal dialog, and closes it", () => {
    act(() => profileButton()!.click());
    const dialog = $<HTMLDialogElement>("dialog.profile-dialog")!;
    expect(dialog.open).toBe(true);
    expect(dialog.getAttribute("aria-labelledby")).toBe("profile-heading");
    expect(dialog.querySelector("#profile-heading")).not.toBeNull();
    clickButton("Close");
    wait(300);
    expect($("dialog.profile-dialog")).toBeNull();
  });

  it("is there between rounds, not during one (the profile's map would give answers away)", () => {
    clickButton("Oceania");
    expect(profileButton()).toBeNull();
    clickButton("Forfeit");
    expect(profileButton()).not.toBeNull();
  });

  it("tells the layout which screen is showing", () => {
    expect($(".game-shell")!.getAttribute("data-screen")).toBe("setup");
    clickButton("Oceania");
    expect($(".game-shell")!.getAttribute("data-screen")).toBe("round");
  });
});

describe("Party Mode (pass-and-play)", () => {
  const graph = buildBorderGraph(countries);
  const puzzle = pickRoute(graph, { random: () => 0 })!;
  const name = (code: string) => byCode.get(code)!.name;
  const title = `${name(puzzle.start)} to ${name(puzzle.end)}`;
  const heading = () => $("#result-heading, #handoff-heading")!.textContent;
  const board = () =>
    [...container.querySelectorAll(".party-row")].map((row) => [...row.children].map((c) => c.textContent).join(" | "));
  /** Walks the shortest route after `seconds` on the clock. */
  function finish(seconds: number) {
    wait(seconds * 1000);
    for (const code of puzzle.shortest.slice(1, -1)) {
      typeKeys(name(code));
      if ($<HTMLInputElement>("input")?.value) pressEnter();
    }
  }

  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    clickButton("Pathfinding");
    clickButton("Start");
  });
  afterEach(() => vi.restoreAllMocks());

  it("Next Player keeps the route and hands over; the clock starts at 00:00 only on Start", () => {
    finish(30);
    clickButton("Next Player");
    expect(heading()).toBe("Player 2, you're up");
    expect(document.activeElement).toBe($("#handoff-heading"));
    // Nothing of player 1's round is left to see: no map, no route, no clock.
    expect($(".map-card")).toBeNull();
    expect($("[role=timer]")).toBeNull();
    expect($("#result-heading")).toBeNull();
    wait(20_000); // passing the phone takes as long as it takes
    clickButton("Start");
    expect($("h1")!.textContent).toBe(`${title}Player 2`);
    expect(timer()).toBe("00:00");
    expect($(".counter-value")!.textContent).toBe("0");
    expect($(".route-prompt")!.textContent).toBe(`You're in ${name(puzzle.start)}. Name a country that borders it.`);
  });

  it("ranks each player's time on the result screen", () => {
    finish(30);
    clickButton("Next Player");
    expect(board()).toEqual([`1 | Player 1 | 00:30 | ${puzzle.par} moves`]); // on the hand-over screen too
    clickButton("Start");
    finish(12);
    expect(heading()).toBe(`Player 2: You reached ${name(puzzle.end)}`);
    expect(board()).toEqual([
      `1 | Player 2just played | 00:12 | ${puzzle.par} moves`,
      `2 | Player 1 | 00:30 | ${puzzle.par} moves`,
    ]);
    clickButton("Next Player");
    clickButton("Start");
    wait(3_000);
    clickButton("Give Up");
    expect(board()[2]).toBe("– | Player 3just played | Gave up | 0 moves");
  });

  it("keeps the shortest route hidden during the party, until someone asks to see it", () => {
    finish(5);
    clickButton("Next Player");
    clickButton("Start");
    clickButton("Give Up");
    expect($('[aria-label="One shortest route"]')).toBeNull();
    expect(container.querySelector(".map-named--missed, .map-marker--missed, .map-note--missed")).toBeNull();
    clickButton("Show the shortest route");
    expect([...container.querySelectorAll('[aria-label="One shortest route"] .chip-name')].map((e) => e.textContent)).toEqual(
      puzzle.shortest.slice(1, -1).map(name),
    );
  });

  it("End party on the hand-over screen goes back to the last result, route shown", () => {
    finish(5);
    clickButton("Next Player");
    clickButton("End party");
    expect(heading()).toBe(`You reached ${name(puzzle.end)}`);
    expect($('[aria-label="One shortest route"]')).not.toBeNull();
    expect($(".party-badge")).toBeNull();
  });

  it("leaving the route (Generate New Route) ends the party", () => {
    finish(5);
    clickButton("Next Player");
    clickButton("Start");
    clickButton("Give Up");
    clickButton("Generate New Route");
    expect($(".party-badge")).toBeNull();
    clickButton("Give Up");
    expect($(".party-board")).toBeNull();
    expect(heading()).toBe("Route abandoned");
  });
});

describe("Save Score", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    clickButton("Pathfinding");
    clickButton("Start");
  });
  afterEach(() => vi.restoreAllMocks());
  const saveButton = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Save Score");

  it("is offered on a won route, not after giving up", async () => {
    const puzzle = pickRoute(buildBorderGraph(countries), { random: () => 0 })!;
    clickButton("Give Up");
    expect(saveButton()).toBeUndefined();
    clickButton("Generate New Route");
    await loadMap();
    for (const code of puzzle.shortest.slice(1, -1)) {
      typeKeys(byCode.get(code)!.name);
      if ($<HTMLInputElement>("input")?.value) pressEnter();
    }
    const row = [...container.querySelectorAll(".route-next__buttons button")].map((b) => b.textContent);
    expect(row).toEqual(["Generate New Route", "Share via QR", "Save Score"]);
    // happy-dom has no canvas: the button says so instead of failing silently.
    await act(async () => saveButton()!.click());
    await act(async () => {});
    expect($(".save-score__status")!.textContent).toBe("Couldn't make the score card in this browser.");
  });
});

describe("Save Score heatmap", () => {
  it("gives the card each step of the route with how long it took to find", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const puzzle = pickRoute(buildBorderGraph(countries), { random: () => 0 })!;
    clickButton("Pathfinding");
    clickButton("Start");
    await loadMap();
    const between = puzzle.shortest.slice(1, -1);
    const pauses = [3, 9, 20, 1, 6, 2, 4, 8].slice(0, between.length);
    between.forEach((code, i) => {
      wait(pauses[i] * 1000);
      typeKeys(byCode.get(code)!.name);
      if ($<HTMLInputElement>("input")?.value) pressEnter();
    });
    scoreCards.inputs.length = 0;
    await act(async () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Save Score")!.click());
    const input = scoreCards.inputs[0] as { heat: { code: string; seconds: number }[]; title: string };
    expect(input.title).toBe(`${byCode.get(puzzle.start)!.name} to ${byCode.get(puzzle.end)!.name}`);
    expect(input.heat).toEqual(between.map((code, i) => ({ code, seconds: pauses[i] })));
    vi.restoreAllMocks();
  });
});

describe("haptics", () => {
  let buzz: ReturnType<typeof vi.fn<(pattern: number[]) => boolean>>;
  const toggle = () => $<HTMLButtonElement>(".haptics-toggle");
  /** Remounts on a device with (or without) the Vibration API and a touch-first pointer. */
  function mountOn({ vibrate = true, coarse = true, splash = false } = {}) {
    act(() => root.unmount());
    buzz = vi.fn<(pattern: number[]) => boolean>(() => true);
    if (vibrate) Object.defineProperty(navigator, "vibrate", { value: buzz, configurable: true, writable: true });
    else delete (navigator as { vibrate?: unknown }).vibrate;
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) => ({ matches: coarse && query === "(pointer: coarse)", media: query }) as MediaQueryList,
    );
    root = createRoot(container);
    act(() => root.render(<CountryGuesser countries={countries} empires={empires} showSplash={splash} />));
  }
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    vi.restoreAllMocks();
  });

  it("offers the toggle on a phone that can vibrate, not on an iPhone (no API) or a desktop (mouse)", () => {
    mountOn();
    expect(toggle()!.getAttribute("aria-label")).toBe("Vibration");
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(toggle()!.closest(".brand-row")).not.toBeNull(); // beside the logo
    mountOn({ vibrate: false });
    expect(toggle()).toBeNull();
    mountOn({ coarse: false });
    expect(toggle()).toBeNull();
  });

  it("buzzes 30 ms on PLAY", async () => {
    mountOn({ splash: true });
    await act(async () => {
      await import("@/components/game/SvgMap");
    });
    await act(async () => {});
    act(() => $<HTMLButtonElement>(".splash-play")!.click());
    expect(buzz).toHaveBeenCalledTimes(1);
    expect(buzz).toHaveBeenCalledWith([30]);
  });

  it("buzzes on a map tap that shows a country, not on the sea", async () => {
    mountOn();
    clickButton("Oceania");
    await loadMap();
    clickButton("Forfeit");
    act(() => {
      $('.world-map [data-code="PNG"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(buzz).toHaveBeenCalledTimes(1);
    act(() => {
      $(".world-map")!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(buzz).toHaveBeenCalledTimes(1);
  });

  it("buzzes once when a route is completed, not on each step", () => {
    mountOn();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const puzzle = pickRoute(buildBorderGraph(countries), { random: () => 0 })!;
    clickButton("Pathfinding");
    clickButton("Start");
    const between = puzzle.shortest.slice(1, -1);
    between.forEach((code, i) => {
      typeKeys(byCode.get(code)!.name);
      if ($<HTMLInputElement>("input")?.value) act(() => $<HTMLButtonElement>("button[type=submit]")!.click());
      expect(buzz).toHaveBeenCalledTimes(i === between.length - 1 ? 1 : 0);
    });
    expect($("#result-heading")!.textContent).toBe(`You reached ${byCode.get(puzzle.end)!.name}`);
  });

  it("turned off, nothing buzzes; turned back on, one buzz says so", async () => {
    mountOn();
    act(() => toggle()!.click());
    expect(toggle()!.getAttribute("aria-pressed")).toBe("false");
    expect(toggle()!.getAttribute("title")).toBe("Vibration off");
    clickButton("Oceania");
    await loadMap();
    clickButton("Forfeit");
    act(() => {
      $('.world-map [data-code="PNG"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(buzz).not.toHaveBeenCalled();
    act(() => toggle()!.click());
    expect(toggle()!.getAttribute("aria-pressed")).toBe("true");
    expect(buzz).toHaveBeenCalledTimes(1);
  });

  it("never throws where vibrate is missing", async () => {
    mountOn({ vibrate: false });
    clickButton("Oceania");
    await loadMap();
    clickButton("Forfeit");
    act(() => {
      $('.world-map [data-code="PNG"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect($(".map-tip")!.textContent).toBe("Papua New Guinea");
  });
});

describe("timer isolation", () => {
  it("timer ticks re-render only the Timer, not the game", () => {
    clickButton("Europe");
    const before = renders.clayCard;
    wait(5_000);
    expect(timer()).toBe("00:05");
    expect(renders.clayCard).toBe(before);
  });
});

describe("sessionReducer", () => {
  const kenya = countries.find((c) => c.code === "KEN")!;
  const ghana = countries.find((c) => c.code === "GHA")!;
  const guess = (c: typeof kenya): Guess => ({ country: c, typed: c.name, distance: 0 });
  const started = sessionReducer(initialSession, {
    type: "start",
    mode: "continent",
    roundKey: "Africa",
    targetCodes: ["KEN", "GHA"],
  });

  it("starts a round in Continent Mode", () => {
    expect(started).toMatchObject({ mode: "continent", roundKey: "Africa", status: "playing", round: 1, guesses: [] });
  });

  it("starts a Historical Mode round", () => {
    const roman = sessionReducer(initialSession, { type: "start", mode: "historical", roundKey: "Roman", targetCodes: ["ITA"] });
    expect(roman).toMatchObject({ mode: "historical", roundKey: "Roman", targetCodes: ["ITA"] });
  });

  it("ignores duplicates and non-targets", () => {
    const once = sessionReducer(started, { type: "guess", guess: guess(kenya) });
    expect(sessionReducer(once, { type: "guess", guess: guess(kenya) })).toBe(once);
    const france = countries.find((c) => c.code === "FRA")!;
    expect(sessionReducer(once, { type: "guess", guess: guess(france) })).toBe(once);
  });

  it("wins on the last target and then ignores further guesses", () => {
    const won = sessionReducer(sessionReducer(started, { type: "guess", guess: guess(kenya) }), {
      type: "guess",
      guess: guess(ghana),
    });
    expect(won.status).toBe("won");
    expect(sessionReducer(won, { type: "forfeit" })).toBe(won);
  });

  it("pathfinding steps extend the route, cut loops, and finish when the route touches the end", () => {
    const puzzle = { start: "PRT", end: "POL", par: 3, shortest: ["PRT", "ESP", "FRA", "DEU", "POL"] };
    const g = (code: string): Guess => ({ country: byCode.get(code)!, typed: code, distance: 0 });
    let s = sessionReducer(initialSession, { type: "startRoute", puzzle });
    expect(s).toMatchObject({ mode: "pathfinding", status: "playing", moves: 0, guesses: [] });
    s = sessionReducer(s, { type: "step", guess: g("ESP"), complete: false });
    s = sessionReducer(s, { type: "step", guess: g("AND"), complete: false });
    s = sessionReducer(s, { type: "step", guess: g("ESP"), complete: false }); // back out of Andorra
    expect(s.guesses.map((x) => x.country.code)).toEqual(["ESP"]);
    expect(s.moves).toBe(3);
    s = sessionReducer(s, { type: "step", guess: g("FRA"), complete: false });
    s = sessionReducer(s, { type: "step", guess: g("DEU"), complete: true });
    expect(s.status).toBe("won");
    expect(s.moves).toBe(5);
  });

  it("counts every committed answer, accepted or not", () => {
    let state = sessionReducer(started, { type: "guess", guess: guess(kenya) });
    state = sessionReducer(state, { type: "miss" });
    state = sessionReducer(state, { type: "miss" });
    expect(state.attempts).toBe(3);
    expect(state.guesses).toHaveLength(1);
    state = sessionReducer(state, { type: "forfeit" });
    expect(sessionReducer(state, { type: "miss" }).attempts).toBe(3); // over: no more counting
  });

  it("marks a round assisted once suggestions show, and a new round starts unassisted", () => {
    const assisted = sessionReducer(started, { type: "assist" });
    expect(assisted.assisted).toBe(true);
    expect(sessionReducer(initialSession, { type: "assist" }).assisted).toBe(false); // not playing
    const next = sessionReducer(assisted, { type: "start", mode: "continent", roundKey: "Africa", targetCodes: ["KEN"] });
    expect(next).toMatchObject({ assisted: false, attempts: 0 });
  });

  it("forfeits, records the time, and resets without losing the round count", () => {
    const forfeited = sessionReducer(started, { type: "forfeit" });
    expect(forfeited.status).toBe("forfeited");
    expect(sessionReducer(forfeited, { type: "timerStopped", elapsedMs: 1234 }).elapsedMs).toBe(1234);
    expect(sessionReducer(forfeited, { type: "reset" })).toMatchObject({ status: "setup", roundKey: null, round: 1 });
  });
});
