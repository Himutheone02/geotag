import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearRounds,
  dailyFromRound,
  dailyId,
  dailyStats,
  countsAsPlayed,
  getSetting,
  listDailies,
  listPartyResults,
  listRounds,
  resetDbConnection,
  saveDaily,
  savePartyResult,
  saveRound,
  setSetting,
  summarize,
  type DailyRecord,
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

describe("dailies (one store, a record per kind and date)", () => {
  const daily = (kind: DailyRecord["kind"], date: string, overrides: Partial<DailyRecord> = {}): DailyRecord => ({
    id: dailyId(kind, date),
    kind,
    date,
    result: "won",
    timeMs: 60_000,
    startedAt: 1_000,
    finishedAt: 61_000,
    label: kind === "guessing" ? "Africa" : "Portugal to China",
    correct: 5,
    target: 5,
    moves: kind === "pathfinding" ? 6 : null,
    par: kind === "pathfinding" ? 5 : null,
    hintsUsed: 0,
    ...overrides,
  });

  it("keeps only the first result per kind and date, and lists each kind apart, oldest first", async () => {
    expect(await saveDaily(daily("guessing", "2026-10-29"))).toBe(true);
    expect(await saveDaily(daily("guessing", "2026-10-29", { result: "forfeited" }))).toBe(false); // a second try
    expect(await saveDaily(daily("pathfinding", "2026-10-29"))).toBe(true); // the other daily, same date
    expect(await saveDaily(daily("guessing", "2026-10-28"))).toBe(true);
    expect((await listDailies("guessing"))!.map((r) => [r.date, r.result])).toEqual([
      ["2026-10-28", "won"],
      ["2026-10-29", "won"],
    ]);
    expect((await listDailies("pathfinding"))!.map((r) => r.id)).toEqual(["pathfinding:2026-10-29"]);
  });

  it("clearing the history clears the dailies too", async () => {
    await saveDaily(daily("guessing", "2026-10-29"));
    await saveRound(round());
    expect(await clearRounds()).toBe(true);
    expect(await listDailies("guessing")).toEqual([]);
    expect(await listRounds()).toEqual([]);
  });

  it("upgrading a version-2 profile moves its dailies into the new store, by kind", async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("country-recall", 2);
      open.onupgradeneeded = () => {
        const db = open.result;
        db.createObjectStore("rounds", { keyPath: "id", autoIncrement: true }).createIndex("finishedAt", "finishedAt");
        db.createObjectStore("settings");
        db.createObjectStore("party", { keyPath: "id", autoIncrement: true }).createIndex("party", "party");
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("rounds", "readwrite");
        const rounds = tx.objectStore("rounds");
        rounds.add(round({ label: "Africa", daily: "2026-10-27", finishedAt: 5_000_000, timeMs: 60_000 }));
        rounds.add(round({ mode: "pathfinding", roundKey: "PRT-CHN", label: "Portugal to China", daily: "2026-10-28", moves: 6, par: 5 }));
        rounds.add(round({ label: "Africa again", daily: "2026-10-27", finishedAt: 9_000_000 })); // a duplicate: later
        rounds.add(round({ label: "ordinary", daily: null }));
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
    const guessing = (await listDailies("guessing"))!;
    expect(guessing.map((r) => [r.id, r.label, r.startedAt])).toEqual([["guessing:2026-10-27", "Africa", 5_000_000 - 60_000]]);
    expect((await listDailies("pathfinding"))!.map((r) => [r.id, r.moves, r.par])).toEqual([["pathfinding:2026-10-28", 6, 5]]);
    expect(await listRounds()).toHaveLength(4); // the rounds themselves stay
  });

  it("dailyFromRound ignores ordinary rounds", () => {
    expect(dailyFromRound({ ...round(), daily: null })).toBeNull();
    expect(dailyFromRound({ ...round(), mode: "historical", daily: "2026-10-01" })!.kind).toBe("guessing");
  });

  it("reports failure quietly without IndexedDB", async () => {
    // @ts-expect-error simulate storage being unavailable
    delete globalThis.indexedDB;
    resetDbConnection();
    expect(await saveDaily(daily("guessing", "2026-10-29"))).toBe(false);
    expect(await listDailies("guessing")).toBeNull();
  });
});

describe("dailyStats", () => {
  /** A Daily Guessing result; a give-up names one country unless `correct` says otherwise. */
  const rec = (date: string, result: DailyRecord["result"] = "won", correct = 1) =>
    ({ kind: "guessing", date, result, correct, moves: null }) as DailyRecord;

  it("a give-up with nothing named (or no move made) isn't a day played", () => {
    expect(countsAsPlayed(rec("2026-10-01", "forfeited", 0))).toBe(false);
    expect(countsAsPlayed(rec("2026-10-01", "forfeited", 1))).toBe(true);
    expect(countsAsPlayed({ kind: "pathfinding", result: "forfeited", correct: 0, moves: 0 })).toBe(false);
    expect(countsAsPlayed({ kind: "pathfinding", result: "forfeited", correct: 1, moves: 1 })).toBe(true);
    expect(countsAsPlayed({ kind: "pathfinding", result: "won", correct: 0, moves: 0 })).toBe(true);
    const records = [rec("2026-10-01"), rec("2026-10-02", "forfeited", 0), rec("2026-10-03")];
    expect(dailyStats(records, "2026-10-03")).toEqual({ played: 2, won: 2, streak: 1, bestStreak: 1 });
  });

  it("counts days played and completed", () => {
    const stats = dailyStats([rec("2026-10-01"), rec("2026-10-02", "forfeited"), rec("2026-10-05")], "2026-10-05");
    expect(stats).toMatchObject({ played: 3, won: 2 });
  });

  it("a streak is consecutive days played, up to today", () => {
    const records = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"].map((d) => rec(d));
    expect(dailyStats(records, "2026-10-29")).toMatchObject({ streak: 4, bestStreak: 4 });
  });

  it("today not played yet keeps the streak alive until midnight; a missed day ends it", () => {
    const records = [rec("2026-10-27"), rec("2026-10-28")];
    expect(dailyStats(records, "2026-10-29").streak).toBe(2); // today still open
    expect(dailyStats(records, "2026-10-30").streak).toBe(0); // the 29th was missed
    expect(dailyStats(records, "2026-10-30").bestStreak).toBe(2);
  });

  it("a give-up still counts as a day played: it keeps the streak going, but isn't a completion", () => {
    const records = [rec("2026-09-01"), rec("2026-09-02", "forfeited"), rec("2026-09-03", "forfeited"), rec("2026-09-04")];
    expect(dailyStats(records, "2026-09-04")).toEqual({ played: 4, won: 2, streak: 4, bestStreak: 4 });
  });

  it("the best streak remembers the longest run of days played", () => {
    const records = [rec("2026-09-01"), rec("2026-09-02", "forfeited"), rec("2026-09-03"), rec("2026-09-05")];
    expect(dailyStats(records, "2026-09-05")).toEqual({ played: 4, won: 3, streak: 1, bestStreak: 3 });
  });

  it("runs across month and year ends", () => {
    const records = [rec("2026-12-30"), rec("2026-12-31"), rec("2027-01-01")];
    expect(dailyStats(records, "2027-01-01")).toMatchObject({ streak: 3, bestStreak: 3 });
  });

  it("is all zeros with nothing played", () => {
    expect(dailyStats([], "2026-10-29")).toEqual({ played: 0, won: 0, streak: 0, bestStreak: 0 });
  });
});
