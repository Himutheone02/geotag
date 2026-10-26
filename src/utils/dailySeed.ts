/**
 * Daily Challenge: one puzzle per calendar date, the same for every player.
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

/**
 * What the Daily Challenge is drawn from: the bundled snapshot's sovereign
 * states, never the live API. Live data is refetched daily and can fall back to
 * the snapshot, so two players on the same date could otherwise draw from
 * different border lists. Sorted by code.
 */
export type DailySource = readonly { code: string; region: string; borders: readonly string[] }[];

/** The countries of a continent in the daily source, limited to codes the game can play. */
export function dailyTargets(source: DailySource, continent: string, playable: ReadonlySet<string>): string[] {
  return source.filter((c) => c.region === continent && playable.has(c.code)).map((c) => c.code);
}

export type DailyChallenge<C extends string> =
  | { date: string; kind: "pathfinding"; puzzle: RoutePuzzle }
  | { date: string; kind: "continent"; continent: C };

/**
 * Today's challenge: a Pathfinding route on about half of days, otherwise
 * naming every country in one continent.
 */
export function dailyChallenge<C extends string>(
  date: string,
  graph: BorderGraph,
  continents: readonly C[],
): DailyChallenge<C> {
  const random = seededRandom(date);
  if (random() < 0.5) {
    const puzzle = pickRoute(graph, { random });
    if (puzzle) return { date, kind: "pathfinding", puzzle };
  }
  const sorted = [...continents].sort();
  return { date, kind: "continent", continent: sorted[Math.floor(random() * sorted.length)] };
}
