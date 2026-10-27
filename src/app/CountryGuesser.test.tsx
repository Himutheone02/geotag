// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import snapshot from "@/data/countries.json";
import { getDailySource, resolveEmpires, toSovereignStates, type RawCountry } from "@/data/loadCountries";
import CountryGuesser, { initialSession, sessionReducer, TYPO_ACCEPT_DELAY_MS, type Guess } from "./CountryGuesser";
import { buildBorderGraph, pickRoute } from "@/utils/pathfinding";
import { dailyChallenge, dateKey } from "@/utils/dailySeed";
import { CONTINENTS } from "./CountryGuesser";

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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const countries = toSovereignStates(snapshot as RawCountry[]);
const empires = resolveEmpires(countries);
const dailySource = getDailySource();
const inRegion = (r: string) => countries.filter((c) => c.region === r);
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CountryGuesser countries={countries} empires={empires} source="snapshot" dailySource={dailySource} />));
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

  it("forfeit shows one shortest route, and New route starts another", () => {
    clickButton("Start");
    clickButton("Forfeit");
    expect($("#result-heading")!.textContent).toBe("Route abandoned");
    expect([...container.querySelectorAll('[aria-label="One shortest route"] .chip-name')].map((e) => e.textContent)).toEqual(
      puzzle.shortest.slice(1, -1).map(name),
    );
    clickButton("New route");
    expect(moves()).toBe("0 moves");
    expect(timer()).toBe("00:00");
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
    act(() => root.render(<CountryGuesser countries={countries} empires={empires} source="snapshot" dailySource={dailySource} />));
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
    clickButton("Forfeit");
    const text = $(".share-preview")!.textContent!;
    expect(text.split("\n")).toEqual([`geotag - Daily Pathfinding ${date}`, "🗺️ 🏳️ gave up after 0 moves ⏱️ 01:12"]);
    for (const c of countries) expect(text).not.toContain(c.name);
  });
});

describe("Daily Challenge uses only the bundled snapshot", () => {
  const snapshotGraph = buildBorderGraph(dailySource);
  // "Live" data that disagrees with the snapshot: no borders at all, and France moved to Asia.
  const live = countries.map((c) => ({ ...c, borders: [], region: c.code === "FRA" ? "Asia" : c.region }));
  function openLiveOn(date: string) {
    act(() => root.unmount());
    const [y, m, d] = date.split("-").map(Number);
    vi.setSystemTime(new Date(y, m - 1, d, 12));
    root = createRoot(container);
    act(() =>
      root.render(<CountryGuesser countries={live} empires={empires} source="rest-countries" dailySource={dailySource} />),
    );
  }
  function dateWith(kind: "pathfinding" | "continent", pred: (c: ReturnType<typeof dailyChallenge<string>>) => boolean = () => true) {
    for (let i = 0; ; i++) {
      const date = dateKey(new Date(2026, 9, 1 + i));
      const c = dailyChallenge(date, snapshotGraph, CONTINENTS);
      if (c.kind === kind && pred(c)) return date;
    }
  }
  const nameOf = (code: string) => byCode.get(code)!.name;

  it("draws and plays the route on snapshot borders, even when live data has none", async () => {
    const date = dateWith("pathfinding");
    const challenge = dailyChallenge(date, snapshotGraph, CONTINENTS);
    if (challenge.kind !== "pathfinding") throw new Error("unreachable");
    openLiveOn(date);
    await act(async () => {});
    clickButton("Play today's challenge");
    expect($("h1")!.textContent).toBe(`${nameOf(challenge.puzzle.start)} to ${nameOf(challenge.puzzle.end)}Daily`);
    // Walk the shortest route: every step is a snapshot border, none exist in the live data.
    for (const code of challenge.puzzle.shortest.slice(1, -1)) typeKeys(nameOf(code));
    expect($("#result-heading")!.textContent).toBe(`You reached ${nameOf(challenge.puzzle.end)}`);
    expect($(".share-preview")!.textContent!.split("\n")[2]).toBe("🟩".repeat(challenge.puzzle.par));
  });

  it("takes a continent's countries from the snapshot, not the live regions", async () => {
    const date = dateWith("continent", (c) => c.kind === "continent" && c.continent === "Europe");
    openLiveOn(date);
    await act(async () => {});
    clickButton("Play today's challenge");
    expect($("h1")!.textContent).toBe("EuropeDaily");
    expect(counter()).toBe("0 / 45"); // France included, as in the snapshot
  });
});

describe("challenge links (?route=)", () => {
  /** Remounts the game as if opened from a link with this query string. */
  function openLink(query: string, live = countries) {
    act(() => root.unmount());
    search.params = new URLSearchParams(query);
    window.history.replaceState(null, "", `/?${query}`);
    root = createRoot(container);
    act(() =>
      root.render(<CountryGuesser countries={live} empires={empires} source="snapshot" dailySource={dailySource} />),
    );
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

  it("plays the route on the bundled snapshot's borders, like the Daily Challenge", () => {
    const live = countries.map((c) => ({ ...c, borders: [] }));
    openLink("route=PRT-POL", live);
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

  it("the route result creates a link to the same route, and offers to play it again", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    openLink("route=FRA-CHN");
    clickButton("Forfeit");
    expect($('[aria-label="Challenge link"]')).toBeNull(); // shown once created
    await act(async () => clickButton("Create NFC Challenge"));
    const link = `${window.location.origin}/?route=FRA-CHN`;
    expect(writeText).toHaveBeenCalledWith(link);
    expect($('[aria-label="Challenge link"]')!.textContent).toBe(link);
    expect(container.textContent).toContain("Write it to an NFC tag");
    expect($(".share-preview")!.textContent).toMatch(/^geotag - Pathfinding Challenge\n/);
    clickButton("Play this route again");
    expect($("h1")!.textContent).toBe("France to China");
  });

  it("random routes get the link too", () => {
    clickButton("Pathfinding");
    clickButton("Start");
    clickButton("Forfeit");
    expect([...container.querySelectorAll("button")].some((b) => b.textContent === "Create NFC Challenge")).toBe(true);
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
    clickButton("Forfeit");
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
