/**
 * Daily Challenges: two puzzles per calendar date (Daily Guessing and Daily
 * Pathfinding), the same for every player. Both change at local midnight.
 *
 * The date string (YYYY-MM-DD) is hashed into a 32-bit seed for Mulberry32, a
 * tiny, fast PRNG. Every choice below is made from sorted lists, never from
 * object or locale-dependent order, so any browser on the same date with the
 * same country data draws the same puzzle.
 */

import { pickRoute, type BorderGraph, type RoutePuzzle } from "./pathfinding";

/** Mulberry32: 32-bit state, period 2^32. Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash: turns the date string into a seed. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The player's local calendar date as YYYY-MM-DD. Like Wordle, the puzzle
 * changes at local midnight, so on any given date everyone gets the same one.
 */
export function dateKey(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Salt mixed into every daily seed. Changing it changes every Daily Challenge, so once
 * the game is live it must stay as it is, even if the brand is renamed again.
 */
export const DAILY_SALT = "geotag";

/** Seeded random number generator for a date. */
export function seededRandom(key: string): () => number {
  return mulberry32(hashString(`${DAILY_SALT}:${key}`));
}

/** The two daily puzzles. Each has its own seed and its own record of results. */
export type DailyKind = "guessing" | "pathfinding";
export const DAILY_KINDS: readonly DailyKind[] = ["guessing", "pathfinding"];

/** Daily Guessing: name every country in one continent. */
export type DailyGuessing<C extends string> = { kind: "guessing"; date: string; continent: C };
/** Daily Pathfinding: connect two countries. */
export type DailyPathfinding = { kind: "pathfinding"; date: string; puzzle: RoutePuzzle };
export type DailyChallenge<C extends string> = DailyGuessing<C> | DailyPathfinding;

/**
 * Today's Daily Guessing round. Seeded with "guess:<date>", apart from the route, so
 * changing how routes are picked never changes which continent comes up, and vice versa.
 */
export function dailyGuessing<C extends string>(date: string, continents: readonly C[]): DailyGuessing<C> {
  const random = seededRandom(`guess:${date}`);
  const sorted = [...continents].sort();
  return { kind: "guessing", date, continent: sorted[Math.floor(random() * sorted.length)] };
}

/**
 * Today's Daily Pathfinding route, seeded with "route:<date>". Null only if the border
 * data has no route of the right length at all.
 *
 * The same date and border data always give the same route, whatever order the countries
 * are listed in (routes are picked from sorted codes). Every player gets the same data, the
 * bundled countries.json, so every player gets the same puzzle; updating that file
 * (npm run snapshot) and redeploying can change future dailies.
 */
export function dailyPathfinding(date: string, graph: BorderGraph): DailyPathfinding | null {
  const puzzle = pickRoute(graph, { random: seededRandom(`route:${date}`) });
  return puzzle ? { kind: "pathfinding", date, puzzle } : null;
}

/* ------------------------------------------------------------------ */
/* Local midnight                                                      */
/* ------------------------------------------------------------------ */

/** Local midnight at the start of the day `at` falls in (ms). */
export function startOfLocalDay(at: number = Date.now()): number {
  return new Date(at).setHours(0, 0, 0, 0);
}

/**
 * The next local midnight after `at` (ms): when both dailies unlock. setHours(24) rolls
 * over to the next calendar day, so a 23- or 25-hour day (daylight saving) still ends at
 * midnight, not 24 hours after the last one.
 */
export function nextLocalMidnight(at: number = Date.now()): number {
  return new Date(startOfLocalDay(at)).setHours(24, 0, 0, 0);
}

/** The calendar date `days` after a YYYY-MM-DD key (negative: before). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dateKey(new Date(y, m - 1, d + days));
}
