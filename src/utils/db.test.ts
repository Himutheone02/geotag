import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRounds,
  getSetting,
  listPartyResults,
  listRounds,
  resetDbConnection,
  savePartyResult,
  saveRound,
  setSetting,
  summarize,
  type RoundRecord,
} from "./db";

const round = (overrides: Partial<RoundRecord> = {}): Omit<RoundRecord, "id"> => ({
  mode: "continent",
  roundKey: "Oceania",
  label: "Oceania",
  result: "won",
  timeMs: 70_000,
  guesses: 16,
  correct: 14,
  target: 14,
  hintsUsed: 0,
  moves: null,
  par: null,
  assisted: false,
  finishedAt: 1_000,
  ...overrides,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory(); // fresh, empty database per test
  resetDbConnection();
});

describe("IndexedDB profile", () => {
  it("saves rounds and lists them newest first", async () => {
    expect(await saveRound(round({ label: "first", finishedAt: 1 }))).toBe(true);
    expect(await saveRound(round({ label: "second", finishedAt: 2 }))).toBe(true);
    const rounds = (await listRounds())!;
    expect(rounds.map((r) => r.label)).toEqual(["second", "first"]);
    expect(rounds[0].id).toBeTypeOf("number");
  });

  it("limits the history", async () => {
    for (let i = 0; i < 5; i++) await saveRound(round({ finishedAt: i }));
    expect((await listRounds(3))!.map((r) => r.finishedAt)).toEqual([4, 3, 2]);
  });

  it("persists across connections (a page reload)", async () => {
    await saveRound(round());
    resetDbConnection();
    expect(await listRounds()).toHaveLength(1);
  });

  it("clears the history", async () => {
    await saveRound(round());
    expect(await clearRounds()).toBe(true);
    expect(await listRounds()).toEqual([]);
  });

  it("stores settings, with a fallback when unset", async () => {
    expect(await getSetting("suggestions", true)).toBe(true);
    await setSetting("suggestions", false);
    expect(await getSetting("suggestions", true)).toBe(false);
  });

  it("degrades quietly when IndexedDB is unavailable", async () => {
    // @ts-expect-error simulate a browser without IndexedDB
    delete globalThis.indexedDB;
    resetDbConnection();
    expect(await saveRound(round())).toBe(false);
    expect(await listRounds()).toBeNull();
    expect(await getSetting("suggestions", true)).toBe(true);
  });
});

describe("summarize", () => {
  it("counts rounds and averages only won rounds, per mode", () => {
    const s = summarize([
      round({ timeMs: 60_000, target: 14 }),
      round({ timeMs: 120_000, target: 54 }),
      round({ result: "forfeited", timeMs: 999_000 }),
      round({ mode: "pathfinding", timeMs: 30_000, moves: 7, par: 5, target: 5 }),
      round({ mode: "pathfinding", timeMs: 50_000, moves: 5, par: 5, target: 5 }),
    ]);
    expect(s.played).toBe(5);
    expect(s.won).toBe(4);
    const continent = s.byMode.find((m) => m.mode === "continent")!;
    expect(continent).toMatchObject({ played: 3, won: 2, avgWinMs: 90_000 });
    expect(continent.secondsPerCountry).toBeCloseTo((60 / 14 + 120 / 54) / 2, 5);
    expect(s.byMode.find((m) => m.mode === "pathfinding")).toMatchObject({ avgWinMs: 40_000, movesOverPar: 1 });
    expect(s.byMode.find((m) => m.mode === "world")).toMatchObject({ played: 0, avgWinMs: null });
  });
});

describe("party results (pass-and-play)", () => {
  const result = (party: string, player: number, timeMs: number) => ({
    party,
    route: "FRA-CHN",
    player,
    won: true,
    timeMs,
    moves: 5,
    finishedAt: player,
  });

  it("saves each player's result and lists one party's, in player order", async () => {
    expect(await savePartyResult(result("a", 2, 50_000))).toBe(true);
    await savePartyResult(result("a", 1, 70_000));
    await savePartyResult(result("b", 1, 10_000)); // another party
    const party = await listPartyResults("a");
    expect(party!.map((r) => [r.player, r.timeMs])).toEqual([
      [1, 70_000],
      [2, 50_000],
    ]);
    expect(await listRounds()).toEqual([]); // never mixed into the profile
  });

  it("upgrading a version-1 profile keeps its rounds and settings", async () => {
    // Build the original (version 1) database, as earlier builds of the game did.
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("country-recall", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore("rounds", { keyPath: "id", autoIncrement: true }).createIndex("finishedAt", "finishedAt");
        db.createObjectStore("settings");
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["rounds", "settings"], "readwrite");
        tx.objectStore("rounds").add(round({ label: "kept" }));
        tx.objectStore("settings").put(false, "suggestions");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    expect((await listRounds())!.map((r) => r.label)).toEqual(["kept"]);
    expect(await getSetting("suggestions", true)).toBe(false);
    expect(await savePartyResult(result("p", 1, 1_000))).toBe(true);
    expect(await listPartyResults("p")).toHaveLength(1);
  });

  it("reports failure quietly without IndexedDB", async () => {
    // @ts-expect-error simulate storage being unavailable
    delete globalThis.indexedDB;
    resetDbConnection();
    expect(await savePartyResult(result("x", 1, 1))).toBe(false);
    expect(await listPartyResults("x")).toBeNull();
  });
});
