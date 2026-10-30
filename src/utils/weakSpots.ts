/**
 * Weak Spots: a practice round of the countries the player is worst at naming, drawn from
 * the same saved answers as the recall heatmap.
 *
 * Every saved list round (countries, not capitals or flags) gives each country it asked for
 * some evidence: an answer and how long it took to come up with, or, in a round given up
 * before it was named, a miss. A country's weakness is its average over all of that, with a
 * miss counted as MISS_SECONDS. The 10 weakest make the round; a player without 10 countries
 * of evidence gets the rest at random, from countries they haven't been asked for yet.
 */

import type { RoundRecord } from "./db";

export const WEAK_SPOTS_SIZE = 10;
/** A country asked for but never named in a given-up round counts as this slow. */
export const MISS_SECONDS = 60;
/**
 * An answer helped by a hint, or picked from the suggestion list, counts as at least this
 * slow. The same floor as the heatmap's for hints (HINT_PENALTY_SECONDS in ProfilePanel).
 */
export const ASSISTED_SECONDS = 30;

export type CountryRecall = {
  code: string;
  /** Average over answers and misses, in seconds. */
  seconds: number;
  answers: number;
  misses: number;
};

/**
 * Country-name recall per country from saved rounds, slowest first. `targetsOf` gives a
 * round's countries from its key, for rounds saved before records carried `targets`.
 */
export function recallWithMisses(
  rounds: readonly RoundRecord[],
  targetsOf: (roundKey: string) => readonly string[] | undefined,
): CountryRecall[] {
  const totals = new Map<string, { seconds: number; answers: number; misses: number }>();
  const add = (code: string, seconds: number, miss: boolean) => {
    const t = totals.get(code) ?? { seconds: 0, answers: 0, misses: 0 };
    t.seconds += seconds;
    if (miss) t.misses++;
    else t.answers++;
    totals.set(code, t);
  };
  for (const r of rounds) {
    // Country names only: routes, flags and capitals are other skills.
    if (r.mode === "pathfinding" || r.mode === "flags" || (r.answer ?? "countries") !== "countries") continue;
    if (!r.answers) continue; // saved before answers were recorded: no timing to go on
    const named = new Set<string>();
    for (const a of r.answers) {
      named.add(a.code);
      const seconds = a.ms / 1000;
      add(a.code, a.hinted || a.picked ? Math.max(seconds, ASSISTED_SECONDS) : seconds, false);
    }
    if (r.result === "forfeited") {
      for (const code of r.targets ?? targetsOf(r.roundKey) ?? []) if (!named.has(code)) add(code, MISS_SECONDS, true);
    }
  }
  return [...totals]
    .map(([code, t]) => ({ code, seconds: t.seconds / (t.answers + t.misses), answers: t.answers, misses: t.misses }))
    .sort((a, b) => b.seconds - a.seconds || b.misses - a.misses || (a.code < b.code ? -1 : 1));
}

export type WeakSpots = {
  /** The round's countries: the weakest first, then the random ones. */
  codes: string[];
  /** How many came from the player's own record (the rest are random). */
  fromProfile: number;
};

/**
 * The practice round: the `size` weakest countries, padded with random ones. Padding comes
 * from countries with no evidence yet when there are enough of them, so it widens what the
 * player has been asked for; otherwise from the rest.
 */
export function pickWeakSpots(
  recall: readonly CountryRecall[],
  allCodes: readonly string[],
  random: () => number = Math.random,
  size = WEAK_SPOTS_SIZE,
): WeakSpots {
  const valid = new Set(allCodes);
  const weakest = recall.filter((r) => valid.has(r.code)).slice(0, size).map((r) => r.code);
  const chosen = new Set(weakest);
  const seen = new Set(recall.map((r) => r.code));
  const unseen = allCodes.filter((c) => !seen.has(c));
  const others = allCodes.filter((c) => seen.has(c) && !chosen.has(c));
  const padding = [...draw(unseen, size - weakest.length, random)];
  padding.push(...draw(others, size - weakest.length - padding.length, random));
  return { codes: [...weakest, ...padding], fromProfile: weakest.length };
}

/** `n` items drawn at random without repeats (a partial Fisher–Yates shuffle). */
function draw<T>(items: readonly T[], n: number, random: () => number): T[] {
  const pool = [...items];
  const out: T[] = [];
  while (out.length < n && pool.length > 0) {
    const i = Math.floor(random() * pool.length);
    out.push(pool[i]);
    pool[i] = pool[pool.length - 1];
    pool.pop();
  }
  return out;
}
