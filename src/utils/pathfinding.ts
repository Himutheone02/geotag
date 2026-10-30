/* ------------------------------------------------------------------ */
/* Land-border graph                                                   */
/* ------------------------------------------------------------------ */

/** cca3 -> cca3 codes of the countries it shares a land border with. */
export type BorderGraph = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * Builds an undirected graph of land borders between the given countries.
 *
 * - Only borders between countries in the list count (borders with
 *   territories such as Western Sahara or French Guiana are dropped).
 * - Only mutual borders count. The data lists India as a neighbour of
 *   Sri Lanka but not the reverse; the two share no land border (the Palk
 *   Strait separates them), so requiring both sides keeps Sri Lanka an island.
 */
export function buildBorderGraph(countries: readonly { code: string; borders: readonly string[] }[]): BorderGraph {
  const listed = new Map(countries.map((c) => [c.code, new Set(c.borders)]));
  const graph = new Map<string, Set<string>>();
  for (const [code, borders] of listed) {
    const mutual = [...borders].filter((other) => listed.get(other)?.has(code));
    graph.set(code, new Set(mutual.sort()));
  }
  return graph;
}

export function areNeighbors(graph: BorderGraph, a: string, b: string): boolean {
  return graph.get(a)?.has(b) ?? false;
}

/** Breadth-first search: number of border crossings from `from` to every reachable country. */
export function bfsDistances(graph: BorderGraph, from: string): Map<string, number> {
  const distance = new Map([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const next of graph.get(current) ?? []) {
      if (!distance.has(next)) {
        distance.set(next, distance.get(current)! + 1);
        queue.push(next);
      }
    }
  }
  return distance;
}

/**
 * One shortest land route, [from, ..., to], or null if there is none.
 * Breadth-first search visiting neighbours alphabetically, so the result is reproducible.
 */
export function shortestPath(graph: BorderGraph, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const previous = new Map<string, string | null>([[from, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    for (const next of graph.get(current) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, current);
      if (next === to) {
        const path = [to];
        for (let step = current; step !== null; step = previous.get(step)!) path.unshift(step);
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Route puzzles                                                       */
/* ------------------------------------------------------------------ */

export type RoutePuzzle = {
  start: string;
  end: string;
  /** Fewest countries that must be named in between (shortest route length minus the two endpoints). */
  par: number;
  /** One shortest route, [start, ..., end]. */
  shortest: string[];
};

/**
 * Countries in between for a random route. Neighbouring pairs (0) make a
 * zero-move round, and the data's longest routes (up to 17) are a slog.
 */
export const MIN_PAR = 3;
export const MAX_PAR = 7;

/** Picks a random start, then a random end that is MIN_PAR..MAX_PAR countries away by land. */
export function pickRoute(
  graph: BorderGraph,
  { minPar = MIN_PAR, maxPar = MAX_PAR, random = Math.random }: { minPar?: number; maxPar?: number; random?: () => number } = {},
): RoutePuzzle | null {
  const starts = [...graph.keys()].filter((code) => graph.get(code)!.size > 0).sort();
  // Fisher-Yates shuffle, then take the first start that has an end in range.
  for (let i = starts.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [starts[i], starts[j]] = [starts[j], starts[i]];
  }
  for (const start of starts) {
    const ends = [...bfsDistances(graph, start)]
      .filter(([, crossings]) => crossings - 1 >= minPar && crossings - 1 <= maxPar)
      .map(([code]) => code)
      .sort();
    if (ends.length === 0) continue;
    const end = ends[Math.floor(random() * ends.length)];
    const shortest = shortestPath(graph, start, end)!;
    return { start, end, par: shortest.length - 2, shortest };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Playing a route (free roam, from both ends)                          */
/* ------------------------------------------------------------------ */

/*
 * The board is the start, the destination, and every country guessed so far. A guess
 * counts if it borders anything on the board: so the route can grow from either end,
 * and a guess can lead nowhere (a dead end) and still count as a move. Every guessed
 * country is therefore joined, by land, to the start or to the destination. The route
 * is complete once the board links the two.
 */

function boardOf(puzzle: RoutePuzzle, guessed: Iterable<string>): Set<string> {
  return new Set([puzzle.start, puzzle.end, ...guessed]);
}

/** The countries a guess may name now: every country bordering the board, not on it yet. */
export function routeFrontier(graph: BorderGraph, puzzle: RoutePuzzle, guessed: readonly string[]): Set<string> {
  const board = boardOf(puzzle, guessed);
  const frontier = new Set<string>();
  for (const code of board) for (const next of graph.get(code) ?? []) if (!board.has(next)) frontier.add(next);
  return frontier;
}

/** True once the guessed countries link the start to the destination by land. */
export function routeComplete(graph: BorderGraph, puzzle: RoutePuzzle, guessed: readonly string[]): boolean {
  const board = boardOf(puzzle, guessed);
  const seen = new Set([puzzle.start]);
  const queue = [puzzle.start];
  for (let i = 0; i < queue.length; i++) {
    for (const next of graph.get(queue[i]) ?? []) {
      if (!board.has(next) || seen.has(next)) continue;
      if (next === puzzle.end) return true;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/**
 * How far out of the way a country is: the extra border crossings a route through it
 * takes over the shortest route. 0: it's on a shortest route.
 */
export function detourOf(graph: BorderGraph, puzzle: RoutePuzzle, code: string): number {
  return detourTable(graph, puzzle)(code);
}

/** detourOf for many countries: the two searches run once, then each lookup is instant. */
export function detourTable(graph: BorderGraph, puzzle: Pick<RoutePuzzle, "start" | "end">): (code: string) => number {
  const fromStart = bfsDistances(graph, puzzle.start);
  const fromEnd = bfsDistances(graph, puzzle.end);
  const direct = fromStart.get(puzzle.end) ?? Infinity;
  return (code) => (fromStart.get(code) ?? Infinity) + (fromEnd.get(code) ?? Infinity) - direct;
}

/**
 * Travle's verdict on a guess, from its detour: "on" a shortest route (0), "near" one
 * (1: a route through it is one country longer), or "off" course (2 or more).
 */
export type RouteVerdict = "on" | "near" | "off";
export function routeVerdict(detour: number): RouteVerdict {
  return detour <= 0 ? "on" : detour === 1 ? "near" : "off";
}

/* ------------------------------------------------------------------ */
/* Challenge links (?route=FRA-CHN)                                    */
/* ------------------------------------------------------------------ */

/** The `route` query value for a puzzle: "FRA-CHN". */
export function routeParam(puzzle: Pick<RoutePuzzle, "start" | "end">): string {
  return `${puzzle.start}-${puzzle.end}`;
}

export type RouteParamResult = { ok: true; puzzle: RoutePuzzle } | { ok: false; reason: string };

/**
 * Reads a challenge link's `?route=` value into a puzzle, or says why it can't be played.
 * Accepts any letter case and surrounding spaces ("fra-chn"). Rejects anything else:
 * malformed values, codes that aren't one of the game's countries, the same country
 * twice, countries with no land route between them, and neighbours (nothing to name).
 *
 * @param nameOf the country's name, or undefined if the game can't play that code
 */
export function parseRouteParam(raw: string, graph: BorderGraph, nameOf: (code: string) => string | undefined): RouteParamResult {
  const shown = raw.length > 24 ? `${raw.slice(0, 24)}…` : raw;
  const match = /^\s*([a-z]{3})-([a-z]{3})\s*$/i.exec(raw);
  if (!match) return { ok: false, reason: `"${shown}" isn't a route. Challenge links end in ?route= and two country codes, like ?route=FRA-CHN.` };
  const [start, end] = [match[1].toUpperCase(), match[2].toUpperCase()];
  for (const code of [start, end]) {
    if (!graph.has(code) || nameOf(code) === undefined) return { ok: false, reason: `${code} isn't a code for one of the game's 195 countries.` };
  }
  const [from, to] = [nameOf(start)!, nameOf(end)!];
  if (start === end) return { ok: false, reason: `The route starts and ends in ${from}.` };
  const shortest = shortestPath(graph, start, end);
  if (!shortest) return { ok: false, reason: `There's no land route from ${from} to ${to}.` };
  if (shortest.length === 2) return { ok: false, reason: `${from} and ${to} share a border, so there's nothing to name in between.` };
  return { ok: true, puzzle: { start, end, par: shortest.length - 2, shortest } };
}
