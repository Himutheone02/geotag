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
/* Playing a route                                                     */
/* ------------------------------------------------------------------ */

/** The country the player is standing in: the last one on their route, or the start. */
export function currentCountry(puzzle: RoutePuzzle, route: readonly string[]): string {
  return route.length ? route[route.length - 1] : puzzle.start;
}

/**
 * Applies a step to the route (codes named so far, start and end excluded).
 * Stepping back onto a country already on the route (or the start) cuts the
 * loop off, so the drawn route stays a clean chain. The caller must already
 * have checked that `code` borders the current country.
 */
export function applyStep(puzzle: RoutePuzzle, route: readonly string[], code: string): string[] {
  if (code === puzzle.start) return [];
  if (code === puzzle.end) return [...route];
  const earlier = route.indexOf(code);
  return earlier >= 0 ? route.slice(0, earlier + 1) : [...route, code];
}

/** True once the route touches the end: the last country named is the end or borders it. */
export function reachesEnd(graph: BorderGraph, puzzle: RoutePuzzle, code: string): boolean {
  return code === puzzle.end || areNeighbors(graph, code, puzzle.end);
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
