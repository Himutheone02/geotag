/**
 * Local player profile, stored in the browser's IndexedDB (raw API, no library).
 *
 * Everything degrades quietly: if IndexedDB is missing or blocked (some private
 * windows, storage disabled), reads return nothing and writes report failure,
 * and the game keeps working.
 */

import type { GameMode } from "@/app/CountryGuesser";
import { addDays, type DailyKind } from "./dailySeed";
import type { AnswerKind } from "./fuzzyMatch";

/** One correct answer in a list round, for the recall heatmap. */
export type AnswerRecord = {
  code: string;
  /** ms since the previous answer (or the start): how long this one took to come up with. */
  ms: number;
  /** A hint pointed at it before it was named (its borders, its outline, or the initials). */
  hinted: boolean;
  /** Chosen from the suggestion list rather than typed. */
  picked: boolean;
};

export type RoundRecord = {
  id?: number;
  mode: GameMode;
  /** "Africa", "Roman", "World", or "PRT-CHN" for a route. */
  roundKey: string;
  /** Display name: "Africa", "Roman Empire", "Portugal to China". */
  label: string;
  result: "won" | "forfeited";
  timeMs: number;
  /** Every answer committed: accepted ones plus rejected submissions. */
  guesses: number;
  /** Countries named (name-them-all modes) or countries on the final route (pathfinding). */
  correct: number;
  /** Countries in the round, or the shortest route's length in between (pathfinding). */
  target: number;
  hintsUsed: number;
  /** Pathfinding only. */
  moves: number | null;
  par: number | null;
  /** The autocomplete list showed answers at some point during the round. */
  assisted: boolean;
  finishedAt: number;
  /** Daily Challenge date (YYYY-MM-DD) when this was the day's first attempt. Absent on older records. */
  daily?: string | null;
  /** "capitals" for Capitals mode rounds. Absent on older records (countries). */
  answer?: AnswerKind;
  /** The spoiler-free share text, so the setup screen can share today's daily again. */
  share?: string;
  /** List rounds: every correct answer in order. Absent on older records and on routes. */
  answers?: AnswerRecord[];
};

/**
 * One player's go at a pass-and-play route (Party Mode). Kept apart from the profile's
 * rounds: several people play on one device, so their times aren't the owner's stats.
 */
export type PartyResult = {
  id?: number;
  /** The party session: every player on the same route, one after another. */
  party: string;
  /** The route, "FRA-CHN". */
  route: string;
  /** 1 for whoever played first, then 2, 3... */
  player: number;
  /** Reached the destination (false: gave up). */
  won: boolean;
  timeMs: number;
  moves: number;
  finishedAt: number;
};

/**
 * The first result of one Daily Challenge, kept in its own store, one record per kind and
 * date: Daily Guessing and Daily Pathfinding each have their own history and streaks.
 * (The round is also saved to the profile's rounds, like any other.)
 */
export type DailyRecord = {
  /** "guessing:2026-10-29": one per kind and date, so only the first attempt is ever kept. */
  id: string;
  kind: DailyKind;
  /** The puzzle's date (YYYY-MM-DD): the local date when the daily was started. */
  date: string;
  result: "won" | "forfeited";
  timeMs: number;
  startedAt: number;
  finishedAt: number;
  /** "Africa", "Portugal to China". */
  label: string;
  /** Countries named (guessing) or countries on the final route (pathfinding). */
  correct: number;
  /** Countries in the round (guessing) or the shortest route's length in between (pathfinding). */
  target: number;
  moves: number | null;
  par: number | null;
  hintsUsed: number;
  /** The spoiler-free share text, so the setup screen can share it again. */
  share?: string;
};

export const dailyId = (kind: DailyKind, date: string) => `${kind}:${date}`;

const DB_NAME = "country-recall";
/**
 * 2: adds the party store. 3: adds the dailies store, filled from the dailies already in
 * the rounds store. Upgrading keeps the rounds, settings and party stores as they are.
 */
const DB_VERSION = 3;
const ROUNDS = "rounds";
const SETTINGS = "settings";
const PARTY = "party";
const DAILIES = "dailies";

/** A daily saved before version 3 (a round with a `daily` date), as a daily record. */
export function dailyFromRound(r: RoundRecord): DailyRecord | null {
  if (!r.daily) return null;
  const kind: DailyKind = r.mode === "pathfinding" ? "pathfinding" : "guessing";
  return {
    id: dailyId(kind, r.daily),
    kind,
    date: r.daily,
    result: r.result,
    timeMs: r.timeMs,
    startedAt: r.finishedAt - r.timeMs,
    finishedAt: r.finishedAt,
    label: r.label,
    correct: r.correct,
    target: r.target,
    moves: r.moves,
    par: r.par,
    hintsUsed: r.hintsUsed,
    share: r.share,
  };
}

let connection: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available"));
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const hadRounds = db.objectStoreNames.contains(ROUNDS);
      if (!hadRounds) {
        db.createObjectStore(ROUNDS, { keyPath: "id", autoIncrement: true }).createIndex("finishedAt", "finishedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
      if (!db.objectStoreNames.contains(PARTY)) {
        db.createObjectStore(PARTY, { keyPath: "id", autoIncrement: true }).createIndex("party", "party");
      }
      if (!db.objectStoreNames.contains(DAILIES)) {
        const dailies = db.createObjectStore(DAILIES, { keyPath: "id" });
        dailies.createIndex("kind", "kind");
        // Carry over the dailies played before version 3: the earliest result per kind and date.
        if (hadRounds) {
          const tx = request.transaction!;
          const found = new Map<string, DailyRecord>();
          const cursor = tx.objectStore(ROUNDS).openCursor();
          cursor.onsuccess = () => {
            const c = cursor.result;
            if (c) {
              const record = dailyFromRound(c.value as RoundRecord);
              const kept = record && found.get(record.id);
              if (record && (!kept || record.finishedAt < kept.finishedAt)) found.set(record.id, record);
              c.continue();
            } else {
              for (const record of found.values()) dailies.put(record);
            }
          };
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer version opened in another tab: step aside so its upgrade isn't blocked.
      db.onversionchange = () => {
        db.close();
        connection = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked by another tab"));
  }).catch((error) => {
    connection = null; // allow a retry later
    throw error;
  });
  return connection;
}

/** Runs one request in its own transaction and resolves when the transaction commits. */
async function run<T>(store: string, mode: IDBTransactionMode, makeRequest: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = makeRequest(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error ?? request.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
  });
}

/** Saves a finished round. Resolves to false if it couldn't be stored. */
export async function saveRound(record: Omit<RoundRecord, "id">): Promise<boolean> {
  try {
    await run(ROUNDS, "readwrite", (s) => s.add(record));
    return true;
  } catch {
    return false;
  }
}

/** Saved rounds, newest first. Null if storage is unavailable. */
export async function listRounds(limit = Infinity): Promise<RoundRecord[] | null> {
  try {
    const all = await run(ROUNDS, "readonly", (s) => s.getAll() as IDBRequest<RoundRecord[]>);
    return all.sort((a, b) => b.finishedAt - a.finishedAt).slice(0, limit);
  } catch {
    return null;
  }
}

/**
 * Saves a Daily Challenge result, unless one is already saved for that kind and date (only
 * the first attempt counts). Resolves to false if it wasn't stored, for either reason.
 */
export async function saveDaily(record: DailyRecord): Promise<boolean> {
  try {
    await run(DAILIES, "readwrite", (s) => s.add(record));
    return true;
  } catch {
    return false; // ConstraintError: already played today; or no storage
  }
}

/** Every saved result of one daily, oldest first. Null if storage is unavailable. */
export async function listDailies(kind: DailyKind): Promise<DailyRecord[] | null> {
  try {
    const all = await run(DAILIES, "readonly", (s) => s.index("kind").getAll(kind) as IDBRequest<DailyRecord[]>);
    return all.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return null;
  }
}

/** Saves one player's result in a pass-and-play party. Resolves to false if it couldn't be stored. */
export async function savePartyResult(result: Omit<PartyResult, "id">): Promise<boolean> {
  try {
    await run(PARTY, "readwrite", (s) => s.add(result));
    return true;
  } catch {
    return false;
  }
}

/** Every saved result of one party, in the order they were saved. Null if storage is unavailable. */
export async function listPartyResults(party: string): Promise<PartyResult[] | null> {
  try {
    const all = await run(PARTY, "readonly", (s) => s.index("party").getAll(party) as IDBRequest<PartyResult[]>);
    return all.sort((a, b) => a.player - b.player);
  } catch {
    return null;
  }
}

/** Clears the profile: every round and every daily result. */
export async function clearRounds(): Promise<boolean> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      // One transaction: both stores are cleared, or neither is.
      const tx = db.transaction([ROUNDS, DAILIES], "readwrite");
      tx.objectStore(ROUNDS).clear();
      tx.objectStore(DAILIES).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted"));
    });
    return true;
  } catch {
    return false;
  }
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  try {
    const value = await run(SETTINGS, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
    return value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

export async function setSetting<T>(key: string, value: T): Promise<boolean> {
  try {
    await run(SETTINGS, "readwrite", (s) => s.put(value, key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the profile database ahead of time (the splash screen waits for this).
 * Resolves true when storage is ready, false when this browser won't store anything;
 * the game works either way, so it never rejects.
 */
export async function initDb(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/** Test hook: forget the cached connection (e.g. after swapping in a fresh fake IndexedDB). */
export function resetDbConnection() {
  connection = null;
}

/* ------------------------------------------------------------------ */
/* Stats (pure)                                                        */
/* ------------------------------------------------------------------ */

export type ModeStats = {
  mode: GameMode;
  played: number;
  won: number;
  /** Mean time of won rounds, or null with none. Forfeit times aren't comparable. */
  avgWinMs: number | null;
  /** Mean seconds per country across won name-them-all rounds (round sizes differ: Mughal 4, World 195). */
  secondsPerCountry: number | null;
  /** Pathfinding: mean moves over the shortest route, across won routes. */
  movesOverPar: number | null;
};

export type ProfileSummary = {
  played: number;
  won: number;
  totalTimeMs: number;
  byMode: ModeStats[];
};

const MODES: GameMode[] = ["continent", "historical", "world", "pathfinding"];
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Summarizes rounds. Pass only unassisted rounds to compare like with like. */
export function summarize(rounds: readonly RoundRecord[]): ProfileSummary {
  return {
    played: rounds.length,
    won: rounds.filter((r) => r.result === "won").length,
    totalTimeMs: rounds.reduce((sum, r) => sum + r.timeMs, 0),
    byMode: MODES.map((mode) => {
      const inMode = rounds.filter((r) => r.mode === mode);
      const wins = inMode.filter((r) => r.result === "won");
      return {
        mode,
        played: inMode.length,
        won: wins.length,
        avgWinMs: mean(wins.map((r) => r.timeMs)),
        secondsPerCountry: mode === "pathfinding" ? null : mean(wins.map((r) => r.timeMs / 1000 / Math.max(1, r.target))),
        movesOverPar:
          mode === "pathfinding" ? mean(wins.filter((r) => r.moves !== null && r.par !== null).map((r) => r.moves! - r.par!)) : null,
      };
    }),
  };
}

export type DailyStats = {
  /** Days played: started and finished, given up or not. */
  played: number;
  /** Completed: every country named, or the route connected. */
  won: number;
  /** Days in a row played, up to today (or up to yesterday, while today is still open). */
  streak: number;
  bestStreak: number;
};

/**
 * Stats for one daily. A streak is consecutive calendar days played: a day counts once its
 * daily is finished, completed or given up, so only a missed day ends a streak. Today not
 * played yet doesn't end it; it's still open until midnight. Completions are counted apart.
 */
export function dailyStats(records: readonly DailyRecord[], today: string): DailyStats {
  const played = new Set(records.map((r) => r.date));
  let bestStreak = 0;
  for (const date of played) {
    if (played.has(addDays(date, -1))) continue; // not the first day of a run
    let length = 1;
    while (played.has(addDays(date, length))) length++;
    bestStreak = Math.max(bestStreak, length);
  }
  let streak = 0;
  let day = played.has(today) ? today : addDays(today, -1);
  while (played.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  const won = new Set(records.filter((r) => r.result === "won").map((r) => r.date));
  return { played: played.size, won: won.size, streak, bestStreak };
}
