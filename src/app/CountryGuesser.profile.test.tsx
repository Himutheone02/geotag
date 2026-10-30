// @vitest-environment happy-dom
// Saving rounds and the Profile & Stats tab, against an in-memory IndexedDB.
// Real timers: fake-indexeddb schedules its work on real timers.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { resolveEmpires, toSovereignStates, type RawCountry } from "@/data/loadCountries";
import {
  dailyId,
  getSetting,
  listDailies,
  listPartyResults,
  listRounds,
  resetDbConnection,
  saveDaily,
  saveRound,
  type DailyRecord,
  type RoundRecord,
} from "@/utils/db";
import { addDays, dateKey } from "@/utils/dailySeed";
import CountryGuesser from "./CountryGuesser";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const countries = toSovereignStates(snapshot as RawCountry[]);
const empires = resolveEmpires(countries);
let container: HTMLDivElement;
let root: Root;

function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<CountryGuesser countries={countries} empires={empires} showSplash={false} />));
}

function unmount() {
  act(() => root.unmount());
  container.remove();
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetDbConnection();
  mount();
});

afterEach(unmount);

const $ = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const $$ = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const input = () => $<HTMLInputElement>("input")!;
const text = (sel: string) => $$(sel).map((e) => e.textContent?.replace(/\s+/g, " ").trim());
const clickButton = (label: string) => {
  const button = $$("button").find((b) => b.textContent?.includes(label));
  if (!button) throw new Error(`No button "${label}"`);
  act(() => button.click());
};
function typeKeys(value: string) {
  const setNative = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  for (const ch of value) {
    act(() => {
      setNative.call(input(), input().value + ch);
      input().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}
const pressEnter = () => act(() => $<HTMLButtonElement>("button[type=submit]")!.click());

/** Retries `check` until it passes, letting IndexedDB and React settle in between. */
async function eventually(check: () => void | Promise<void>, timeoutMs = 3000) {
  const started = Date.now();
  for (;;) {
    try {
      await check();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw error;
    }
    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
}

const record = (overrides: Partial<RoundRecord>): Omit<RoundRecord, "id"> => ({
  mode: "continent",
  roundKey: "Oceania",
  label: "Oceania",
  result: "won",
  timeMs: 70_000,
  guesses: 15,
  correct: 14,
  target: 14,
  hintsUsed: 0,
  moves: null,
  par: null,
  assisted: false,
  finishedAt: Date.UTC(2026, 9, 20, 18, 0),
  ...overrides,
});

describe("saving rounds", () => {
  it("saves a finished round: mode, time, guesses made, hints used, and when", async () => {
    clickButton("Oceania");
    typeKeys("Fiji"); // accepted
    typeKeys("Narnia");
    pressEnter(); // rejected, but still a guess
    clickButton("Capital City");
    const before = Date.now();
    clickButton("Forfeit");

    await eventually(async () => expect(await listRounds()).toHaveLength(1));
    const [saved] = (await listRounds())!;
    expect(saved).toMatchObject({
      mode: "continent",
      roundKey: "Oceania",
      label: "Oceania",
      result: "forfeited",
      guesses: 2,
      correct: 1,
      target: 14,
      hintsUsed: 1,
      moves: null,
      assisted: true, // the list showed answers while typing
    });
    expect(saved.timeMs).toBeGreaterThanOrEqual(0);
    expect(saved.finishedAt).toBeGreaterThanOrEqual(before);
  });

  it("saves each round once, and a round played with suggestions off is unassisted", async () => {
    clickButton("Oceania");
    clickButton("Suggestions"); // off before typing anything
    typeKeys("Fiji");
    clickButton("Forfeit");
    clickButton("Play Oceania again");
    clickButton("Forfeit");

    await eventually(async () => expect(await listRounds()).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rounds = (await listRounds())!;
    expect(rounds).toHaveLength(2);
    expect(rounds.map((r) => r.assisted)).toEqual([false, false]);
  });

  it("remembers the Suggestions setting across visits", async () => {
    clickButton("Europe");
    clickButton("Suggestions");
    await eventually(async () => expect(await getSetting("suggestions", true)).toBe(false));
    unmount();
    mount();
    await act(() => new Promise((resolve) => setTimeout(resolve, 100))); // the setting loads from IndexedDB
    clickButton("Europe");
    expect($("button.suggest-toggle")!.getAttribute("aria-pressed")).toBe("false");
    typeKeys("b");
    expect($("[role=listbox]")).toBeNull();
  });
});

describe("Phase 6 records", () => {
  it("saves a Capitals round under its own key, with its share text", async () => {
    clickButton("Capitals");
    clickButton("Oceania");
    typeKeys("Suva");
    clickButton("Forfeit");
    await eventually(async () => expect(await listRounds()).toHaveLength(1));
    const [saved] = (await listRounds())!;
    expect(saved).toMatchObject({ roundKey: "Oceania:capitals", label: "Oceania capitals", answer: "capitals", correct: 1, daily: null });
    expect(saved.share).toMatch(/^geotag - Oceania Capitals\n🏙️ 1\/14 🏳️/);
  });

  const playButton = (kind: string) =>
    $$(`.daily-card[data-kind="${kind}"] button`).find((b) => /^Play/.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

  it("after today's Daily Guessing, its card shows the result and stats, shares it, and a replay isn't the daily", async () => {
    await eventually(() => expect(playButton("guessing")?.disabled).toBe(false));
    expect(playButton("guessing")!.textContent).toBe("Play");
    act(() => playButton("guessing")!.click());
    clickButton("Forfeit");
    await eventually(async () => expect(await listDailies("guessing")).toHaveLength(1));
    const [first] = (await listRounds())!;
    expect(first.daily).toBe(dateKey());
    expect(first.share).toContain(`Daily Guessing ${dateKey()}`);
    const [saved] = (await listDailies("guessing"))!;
    expect(saved).toMatchObject({ id: dailyId("guessing", dateKey()), kind: "guessing", date: dateKey(), result: "forfeited", correct: 0 });
    expect(saved.startedAt).toBeLessThanOrEqual(saved.finishedAt);
    expect(await listDailies("pathfinding")).toEqual([]); // the other daily is untouched

    clickButton("Choose another round");
    const guessing = () => $('.daily-card[data-kind="guessing"]')!;
    await eventually(() => expect(guessing().querySelector(".daily-card__done")?.textContent).toMatch(/^Done today: 0\/\d+ in \d\d:\d\d \(gave up\)\.$/));
    expect(guessing().querySelector(".share-button")).not.toBeNull();
    // A give-up is still a day played: it starts a streak, but isn't a completion.
    expect(text('.daily-card[data-kind="guessing"] .daily-stats > div')).toEqual(["Played1", "Completed0", "Streak1", "Best1"]);
    expect($('.daily-card[data-kind="pathfinding"] .daily-card__done')).toBeNull();
    expect($('.daily-card[data-kind="pathfinding"] .daily-stats')).toBeNull(); // nothing played yet

    clickButton("Play again");
    clickButton("Forfeit");
    await eventually(async () => expect(await listRounds()).toHaveLength(2));
    const [replay] = (await listRounds())!;
    expect(replay.daily).toBeNull();
    expect(replay.share).not.toContain("Daily");
    expect(await listDailies("guessing")).toHaveLength(1); // still the first attempt
  });

  it("each daily keeps its own streak", async () => {
    const today = dateKey();
    const won = (kind: DailyRecord["kind"], date: string): DailyRecord => ({
      id: dailyId(kind, date),
      kind,
      date,
      result: "won",
      timeMs: 1_000,
      startedAt: 0,
      finishedAt: 1_000,
      label: "x",
      correct: 1,
      target: 1,
      moves: kind === "pathfinding" ? 5 : null,
      par: kind === "pathfinding" ? 5 : null,
      hintsUsed: 0,
    });
    for (const days of [1, 2, 3]) await saveDaily(won("pathfinding", addDays(today, -days)));
    await saveDaily(won("guessing", addDays(today, -1)));
    unmount();
    mount();
    await eventually(() => expect(text('.daily-card[data-kind="pathfinding"] .daily-stats > div')).toEqual(["Played3", "Completed3", "Streak3", "Best3"]));
    expect(text('.daily-card[data-kind="guessing"] .daily-stats > div')).toEqual(["Played1", "Completed1", "Streak1", "Best1"]);
    expect(playButton("pathfinding")!.textContent).toBe("Play"); // today's still open
  });
});

describe("Phase 7: recall data, heatmap and stamps", () => {
  it("saves each answer's recall time, and whether it was hinted or picked from the list", async () => {
    clickButton("Oceania");
    await new Promise((resolve) => setTimeout(resolve, 30));
    typeKeys("Fiji");
    clickButton("Capital City"); // about one missing country: naming that one counts as hinted
    const hint = $(".hint-text")!.textContent!;
    const hinted = countries.find((c) => c.region === "Oceania" && c.capitals.length > 0 && hint.includes(` ${c.capitals.join(", ")}.`))!;
    typeKeys(hinted.name);
    if (input().value) pressEnter();
    const other = hinted.code === "WSM" ? { code: "TON", typed: "ton", label: "Tonga" } : { code: "WSM", typed: "sam", label: "Samoa" };
    typeKeys(other.typed);
    act(() => $$("[role=option]").find((o) => o.textContent === other.label)!.click());
    clickButton("Forfeit");
    await eventually(async () => expect(await listRounds()).toHaveLength(1));
    const [saved] = (await listRounds())!;
    expect(saved.answers!.map((a) => [a.code, a.hinted, a.picked])).toEqual([
      ["FJI", false, false],
      [hinted.code, true, false],
      [other.code, false, true], // named after the hint, but the hint wasn't about it
    ]);
    expect(saved.answers![0].ms).toBeGreaterThanOrEqual(25);
    expect(saved.answers!.every((a) => a.ms >= 0)).toBe(true);
  });

  it("colors the heatmap by recall speed, with a legend and lists", async () => {
    const answers = [
      { code: "FJI", ms: 2000, hinted: false, picked: false }, // green
      { code: "AUS", ms: 7000, hinted: false, picked: false }, // olive
      { code: "TUV", ms: 3000, hinted: true, picked: false }, // hinted: red
    ];
    await saveRound(record({ answers }));
    clickButton("Profile & Stats");
    await eventually(() => expect($(".heatmap .map-named--fill")).not.toBeNull());
    const fill = (code: string) => $(`.heatmap .map-named--fill[data-code="${code}"], .heatmap .map-marker--fill[data-code="${code}"]`)?.style.fill;
    expect(fill("FJI")).toBe("#3cc96a");
    expect(fill("AUS")).toBe("#aa8f13");
    expect(fill("TUV")).toBe("#a71f2d");
    expect(fill("NZL")).toBeUndefined(); // never named: left blank
    expect(text(".heat-legend li")).toEqual(["Under 4 s 1", "4–10 s 1", "10–20 s 0", "Over 20 s 1", "Not named yet 192"]);
    expect(text(".heat-list li")).toEqual(["Tuvalu30.0 s", "Australia7.0 s", "Fiji2.0 s"]);
  });

  it("shows stamps as earned tokens or empty impressions", async () => {
    await saveRound(record({ mode: "world", roundKey: "World", label: "World", result: "forfeited", finishedAt: Date.UTC(2026, 9, 26, 12) }));
    clickButton("Profile & Stats");
    await eventually(() => expect($(".stamps")).not.toBeNull());
    expect(text(".stamp-slot--earned .stamp-name")).toEqual(["World Traveler"]);
    expect(text(".stamp-slot:not(.stamp-slot--earned) .stamp-name")).toEqual(["Roman Emperor", "Speedrunner"]);
    expect($('[data-stamp="world-traveler"] .stamp-status')!.textContent).toMatch(/^Earned Oct 2[56], 2026$/);
    expect($('[data-stamp="speedrunner"] .stamp-status')!.textContent).toBe(
      "Not earned yet. Complete Africa, the Americas, Asia or Europe averaging under 3 s per country, with suggestions off.",
    );
    expect($("#stamps-heading")!.textContent).toBe("Passport stamps 1 of 3");
  });

  it("shows the stamps even before any round is played", async () => {
    clickButton("Profile & Stats");
    await eventually(() => expect($(".stamps")).not.toBeNull());
    expect($$(".stamp-slot")).toHaveLength(3);
    expect($$(".stamp-slot--earned")).toHaveLength(0);
  });
});

describe("Profile & Stats tab", () => {
  async function openProfile() {
    clickButton("Profile & Stats");
    await eventually(() => expect($(".profile[aria-busy]")).toBeNull());
  }

  it("says so when there's nothing saved yet", async () => {
    await openProfile();
    expect($(".profile .empty")!.textContent).toBe("No rounds yet. Finish or forfeit one and it shows up here.");
  });

  it("shows totals, average winning time per mode, bests and recent rounds", async () => {
    await saveRound(record({ timeMs: 60_000, finishedAt: 1 }));
    await saveRound(record({ timeMs: 90_000, finishedAt: 2 }));
    await saveRound(record({ result: "forfeited", timeMs: 30_000, correct: 5, finishedAt: 3, assisted: true }));
    await saveRound(
      record({
        mode: "pathfinding",
        roundKey: "PRT-POL",
        label: "Portugal to Poland",
        timeMs: 45_000,
        moves: 4,
        par: 3,
        target: 3,
        correct: 3,
        finishedAt: 4,
      }),
    );
    await openProfile();

    expect(text(".stat-tile")).toEqual(["Games played4", "Rounds won3 75%", "Time played03:45"]);
    expect(text(".mode-bar")).toEqual([
      "Continents01:155.4 s per country · 2 of 3 rounds won",
      "Empires–Not played yet",
      "World–Not played yet",
      "Pathfinding00:451.0 moves over the shortest route · 1 of 1 round won",
    ]);
    expect(text(".best-chip")).toEqual(["Oceania01:002 wins"]);
    expect(text(".history-row__label")).toEqual(["Portugal to Poland", "Oceania", "Oceania", "Oceania"]);
    expect(text(".history-row__meta")).toEqual([
      "Pathfinding · 4 moves, shortest 3 · 15 guesses",
      "Continents · 5/14 named · 15 guesses · no hints",
      "Continents · 14/14 named · 15 guesses · no hints",
      "Continents · 14/14 named · 15 guesses · no hints",
    ]);
    expect(text(".history-row__tags")).toEqual(["Won", "ForfeitedSuggestions", "Won", "WonBest"]);
  });

  it("filters to rounds played without suggestions", async () => {
    await saveRound(record({ assisted: false }));
    await saveRound(record({ assisted: true, finishedAt: 9 }));
    await openProfile();
    clickButton("Without suggestions");
    expect(text(".stat-tile")[0]).toBe("Games played1");
    expect($$(".history-row")).toHaveLength(1);
  });

  it("clears the history only after confirming", async () => {
    await saveRound(record({}));
    await openProfile();
    clickButton("Clear history");
    expect($("[role=alert]")!.textContent).toBe("Delete all 1 saved round and your daily streaks? This can't be undone.");
    clickButton("Keep it");
    expect($$(".history-row")).toHaveLength(1);
    clickButton("Clear history");
    clickButton("Delete history");
    await eventually(() => expect($(".profile .empty")?.textContent).toMatch(/^No rounds yet/));
    expect(await listRounds()).toEqual([]);
  });

  it("explains when the browser won't store anything", async () => {
    // @ts-expect-error simulate storage being unavailable
    delete globalThis.indexedDB;
    resetDbConnection();
    await openProfile();
    expect($(".profile .empty")!.textContent).toMatch(/^This browser isn't letting the game store anything/);
  });
});

describe("vibration setting", () => {
  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate;
    window.matchMedia = originalMatchMedia;
  });
  const originalMatchMedia = window.matchMedia;

  it("is remembered: turned off, it stays off next visit", async () => {
    Object.defineProperty(navigator, "vibrate", { value: () => true, configurable: true, writable: true });
    window.matchMedia = ((query: string) => ({ matches: query === "(pointer: coarse)", media: query })) as typeof window.matchMedia;
    unmount();
    mount();
    const toggle = () => $<HTMLButtonElement>(".haptics-toggle")!;
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    act(() => toggle().click());
    await eventually(async () => expect(await getSetting("haptics", true)).toBe(false));
    unmount();
    mount();
    await eventually(() => expect(toggle().getAttribute("aria-pressed")).toBe("false"));
  });
});

describe("Party Mode storage", () => {
  it("saves every player's time in IndexedDB, and only player 1's round in the profile", async () => {
    clickButton("Pathfinding");
    clickButton("Start");
    clickButton("Give Up");
    await eventually(async () => expect(await listRounds()).toHaveLength(1)); // player 1: an ordinary round
    clickButton("Next Player");
    clickButton("Start");
    clickButton("Give Up");
    clickButton("Next Player");
    clickButton("Start");
    clickButton("Give Up");
    await eventually(() => expect($$(".party-row")).toHaveLength(3));
    const rounds = await listRounds();
    expect(rounds).toHaveLength(1); // players 2 and 3 aren't the profile owner
    const routeKey = rounds![0].roundKey;
    // The leaderboard shows what IndexedDB holds for this party.
    const all = await new Promise<{ party: string; route: string; player: number }[]>((resolve) => {
      const open = indexedDB.open("country-recall");
      open.onsuccess = () => {
        const req = open.result.transaction("party").objectStore("party").getAll();
        req.onsuccess = () => {
          open.result.close();
          resolve(req.result);
        };
      };
    });
    expect(all.map((r) => r.player)).toEqual([1, 2, 3]);
    expect(new Set(all.map((r) => r.route))).toEqual(new Set([routeKey]));
    expect(await listPartyResults(all[0].party)).toHaveLength(3);
  });
});
