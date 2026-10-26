/**
 * Wordle-style, spoiler-free result text: no country names, just counts, time
 * and a row of colored squares.
 */

import { bfsDistances, type BorderGraph, type RoutePuzzle } from "./pathfinding";

/** The product name: page title, header and share text all use this. */
export const BRAND_NAME = "geotag";

export const SQUARES = { good: "🟩", ok: "🟨", bad: "🟥", missed: "⬜" } as const;

/** Pace thresholds for the name-them-all grid, in seconds per country. */
export const PACE_GOOD_SECONDS = 6;
export const PACE_OK_SECONDS = 15;

/**
 * Pathfinding: one square per move.
 * 🟩 moved one country closer to the destination, 🟨 stayed as far, 🟥 moved away
 * (including steps back). A perfect route is all green, one square per country in between.
 */
export function routeGrid(graph: BorderGraph, puzzle: RoutePuzzle, path: readonly string[]): string {
  const toEnd = bfsDistances(graph, puzzle.end);
  let previous = puzzle.start;
  let grid = "";
  for (const code of path) {
    if (code === puzzle.end) continue; // naming the destination itself isn't a move
    const before = toEnd.get(previous) ?? Infinity;
    const after = toEnd.get(code) ?? Infinity;
    grid += after < before ? SQUARES.good : after === before ? SQUARES.ok : SQUARES.bad;
    previous = code;
  }
  return grid;
}

/**
 * Name-them-all rounds: up to 10 squares, each a tenth of the round's countries
 * in the order you named them, colored by how fast that tenth went:
 * 🟩 up to 6 s per country, 🟨 up to 15 s, 🟥 slower, ⬜ not reached (forfeit).
 *
 * @param times ms since the round started at which each country was named, in order
 */
export function paceGrid(times: readonly number[], total: number): string {
  const squares = Math.min(10, total);
  let grid = "";
  let previousTime = 0;
  let previousCount = 0;
  for (let i = 1; i <= squares; i++) {
    const count = Math.ceil((i * total) / squares);
    if (times.length < count) {
      grid += SQUARES.missed;
      continue;
    }
    const seconds = (times[count - 1] - previousTime) / 1000 / (count - previousCount);
    grid += seconds <= PACE_GOOD_SECONDS ? SQUARES.good : seconds <= PACE_OK_SECONDS ? SQUARES.ok : SQUARES.bad;
    previousTime = times[count - 1];
    previousCount = count;
  }
  return grid;
}

/** MM:SS, matching the in-game timer. */
export function formatShareTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export type ShareInput = {
  /** "Pathfinding", "Africa", "Europe Capitals"… */
  title: string;
  /** YYYY-MM-DD for the Daily Challenge, null otherwise. */
  daily: string | null;
  won: boolean;
  timeMs: number;
  grid: string;
  /** The autocomplete list showed answers during the round. */
  assisted: boolean;
} & (
  | { kind: "route"; moves: number; par: number }
  | { kind: "list"; emoji: string; named: number; total: number; hints: number }
);

/**
 *   geotag - Daily Pathfinding 2026-10-26
 *   🗺️ 5 moves (shortest 4) ⏱️ 01:12
 *   🟩🟩🟨🟩🟩
 */
export function buildShareText(input: ShareInput): string {
  const heading = `${BRAND_NAME} - ${input.daily ? `Daily ${input.title} ${input.daily}` : input.title}`;
  const time = `⏱️ ${formatShareTime(input.timeMs)}`;
  let stats: string;
  if (input.kind === "route") {
    const moves = `${input.moves} ${input.moves === 1 ? "move" : "moves"}`;
    stats = input.won ? `🗺️ ${moves} (shortest ${input.par}) ${time}` : `🗺️ 🏳️ gave up after ${moves} ${time}`;
  } else {
    const hints = input.hints > 0 ? ` 💡 ${input.hints}` : "";
    stats = `${input.emoji} ${input.named}/${input.total}${input.won ? "" : " 🏳️"} ${time}${hints}`;
  }
  return [heading, stats, input.grid, input.assisted ? "🔤 with suggestions" : ""].filter(Boolean).join("\n");
}
