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

/** Daily Guessing: name every country in one round (a continent, an empire, or the World). */
export type DailyGuessing<K extends string> = { kind: "guessing"; date: string; round: K };
/** Daily Pathfinding: connect two countries. */
export type DailyPathfinding = { kind: "pathfinding"; date: string; puzzle: RoutePuzzle };
export type DailyChallenge<K extends string> = DailyGuessing<K> | DailyPathfinding;

/** Whole days from 1970-01-01 to a YYYY-MM-DD date. Pure calendar arithmetic: no time zone, no DST. */
export function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Fisher–Yates shuffle driven by a seeded generator. */
function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Today's Daily Guessing round, dealt from the pool like a shuffled deck: the calendar is cut
 * into cycles as long as the pool, each cycle gets its own shuffle (seeded with the pool size
 * and the cycle number), and each day takes the next card. So every round comes up exactly
 * once per cycle.
 *
 * Where one deck meets the next, a round could come straight back. So the last `spacing`
 * cards of a deck (a third of the pool) may not open the next one: any that would are
 * swapped with cards from the middle. A round therefore never returns within `spacing` days
 * (with the 11-round pool: always at least 4 days apart). The swaps never touch a deck's
 * last `spacing` cards, so each deck needs only the raw shuffle of the one before, never a
 * chain back through the calendar.
 *
 * Seeded apart from the route, so changing how routes are picked never changes the round, and
 * vice versa. The pool is sorted first, so its order doesn't matter; its contents do: adding or
 * removing a round reshuffles every future Daily Guessing.
 */
export function dailyGuessing<K extends string>(date: string, pool: readonly K[]): DailyGuessing<K> {
  const sorted = [...new Set(pool)].sort();
  const n = sorted.length;
  const day = dayNumber(date);
  const cycle = Math.floor(day / n);
  const position = day - cycle * n;
  const shuffled = (c: number) => shuffle(sorted, seededRandom(`guess-deck:${n}:${c}`));
  const deck = shuffled(cycle);
  const spacing = Math.floor(n / 3);
  if (spacing > 0) {
    const recent = new Set(shuffled(cycle - 1).slice(n - spacing));
    for (let i = 0; i < spacing; i++) {
      if (!recent.has(deck[i])) continue;
      // There's always one: the middle holds n - 2·spacing cards, at most spacing of them recent.
      const j = deck.findIndex((card, k) => k >= spacing && k < n - spacing && !recent.has(card));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
  }
  return { kind: "guessing", date, round: deck[position] };
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
