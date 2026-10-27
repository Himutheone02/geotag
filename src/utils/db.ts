/**
 * Local player profile, stored in the browser's IndexedDB (raw API, no library).
 *
 * Everything degrades quietly: if IndexedDB is missing or blocked (some private
 * windows, storage disabled), reads return nothing and writes report failure,
 * and the game keeps working.
 */

import type { GameMode } from "@/app/CountryGuesser";
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

const DB_NAME = "country-recall";
const DB_VERSION = 1;
const ROUNDS = "rounds";
const SETTINGS = "settings";

let connection: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB is not available"));
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ROUNDS)) {
        db.createObjectStore(ROUNDS, { keyPath: "id", autoIncrement: true }).createIndex("finishedAt", "finishedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS)) db.createObjectStore(SETTINGS);
    };
    request.onsuccess = () => resolve(request.result);
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

export async function clearRounds(): Promise<boolean> {
  try {
    await run(ROUNDS, "readwrite", (s) => s.clear());
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
