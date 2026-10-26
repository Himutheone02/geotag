import { describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { toSovereignStates, type RawCountry } from "@/data/loadCountries";
import {
  applyStep,
  areNeighbors,
  bfsDistances,
  buildBorderGraph,
  currentCountry,
  MAX_PAR,
  MIN_PAR,
  parseRouteParam,
  pickRoute,
  reachesEnd,
  routeParam,
  shortestPath,
  type RoutePuzzle,
} from "./pathfinding";

const countries = toSovereignStates(snapshot as RawCountry[]);
const graph = buildBorderGraph(countries);

/** Small deterministic random number generator for repeatable tests. */
function seeded(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("buildBorderGraph", () => {
  it("covers all 195 countries, with symmetric borders", () => {
    expect(graph.size).toBe(195);
    for (const [a, neighbours] of graph) for (const b of neighbours) expect(graph.get(b)!.has(a)).toBe(true);
  });

  it("keeps real land borders, including exclaves and the Sinai", () => {
    expect(areNeighbors(graph, "PRT", "ESP")).toBe(true);
    expect(areNeighbors(graph, "ESP", "MAR")).toBe(true); // Ceuta and Melilla
    expect(areNeighbors(graph, "EGY", "ISR")).toBe(true);
    expect(areNeighbors(graph, "RUS", "PRK")).toBe(true);
  });

  it("drops one-sided borders (Sri Lanka lists India; there is no land border)", () => {
    expect(areNeighbors(graph, "LKA", "IND")).toBe(false);
    expect(graph.get("LKA")!.size).toBe(0);
  });

  it("drops borders with territories that aren't sovereign states", () => {
    expect(graph.get("MAR")!.has("ESH")).toBe(false);
    expect(graph.get("BRA")!.has("GUF")).toBe(false);
  });

  it("separates the Americas from Eurasia and Africa", () => {
    expect(bfsDistances(graph, "PRT").has("CHN")).toBe(true);
    expect(bfsDistances(graph, "PRT").has("ZAF")).toBe(true);
    expect(bfsDistances(graph, "PRT").has("BRA")).toBe(false);
    expect(bfsDistances(graph, "CAN").get("ARG")).toBeGreaterThan(0);
  });
});

describe("shortestPath", () => {
  it("finds Portugal to China with 5 countries in between", () => {
    const path = shortestPath(graph, "PRT", "CHN")!;
    expect(path[0]).toBe("PRT");
    expect(path.at(-1)).toBe("CHN");
    expect(path.length - 2).toBe(5);
    for (let i = 1; i < path.length; i++) expect(areNeighbors(graph, path[i - 1], path[i])).toBe(true);
  });

  it("matches the breadth-first distance for every reachable pair from a sample of starts", () => {
    for (const start of ["PRT", "ZAF", "KOR", "NOR", "CHL", "VNM"]) {
      for (const [end, crossings] of bfsDistances(graph, start)) {
        expect(shortestPath(graph, start, end)!.length - 1).toBe(crossings);
      }
    }
  });

  it("returns null across water, and [x] for the same country", () => {
    expect(shortestPath(graph, "PRT", "BRA")).toBeNull();
    expect(shortestPath(graph, "JPN", "CHN")).toBeNull();
    expect(shortestPath(graph, "FRA", "FRA")).toEqual(["FRA"]);
  });
});

describe("pickRoute", () => {
  it("always returns a connected pair within the difficulty band", () => {
    const random = seeded(7);
    for (let i = 0; i < 200; i++) {
      const puzzle = pickRoute(graph, { random })!;
      expect(puzzle.par).toBeGreaterThanOrEqual(MIN_PAR);
      expect(puzzle.par).toBeLessThanOrEqual(MAX_PAR);
      expect(bfsDistances(graph, puzzle.start).get(puzzle.end)! - 1).toBe(puzzle.par);
      expect(puzzle.shortest[0]).toBe(puzzle.start);
      expect(puzzle.shortest.at(-1)).toBe(puzzle.end);
    }
  });

  it("varies the start and end", () => {
    const random = seeded(11);
    const pairs = new Set(Array.from({ length: 50 }, () => pickRoute(graph, { random })!).map((p) => `${p.start}-${p.end}`));
    expect(pairs.size).toBeGreaterThan(40);
  });

  it("never picks islands or the tiny components (Ireland–UK, Haiti–Dominican Republic)", () => {
    const random = seeded(3);
    for (let i = 0; i < 300; i++) {
      const { start, end } = pickRoute(graph, { random })!;
      for (const code of [start, end]) expect(["IRL", "GBR", "HTI", "DOM", "LKA", "JPN"]).not.toContain(code);
    }
  });
});

describe("playing a route", () => {
  const puzzle: RoutePuzzle = { start: "PRT", end: "POL", par: 3, shortest: ["PRT", "ESP", "FRA", "DEU", "POL"] };

  it("tracks the current country", () => {
    expect(currentCountry(puzzle, [])).toBe("PRT");
    expect(currentCountry(puzzle, ["ESP", "FRA"])).toBe("FRA");
  });

  it("extends the route, and cuts loops off when stepping back", () => {
    expect(applyStep(puzzle, [], "ESP")).toEqual(["ESP"]);
    expect(applyStep(puzzle, ["ESP", "AND"], "ESP")).toEqual(["ESP"]); // back out of Andorra
    expect(applyStep(puzzle, ["ESP", "FRA", "BEL"], "FRA")).toEqual(["ESP", "FRA"]);
    expect(applyStep(puzzle, ["ESP"], "PRT")).toEqual([]); // back to the start
  });

  it("is complete once the route touches the end", () => {
    expect(reachesEnd(graph, puzzle, "FRA")).toBe(false);
    expect(reachesEnd(graph, puzzle, "DEU")).toBe(true); // Germany borders Poland
    expect(reachesEnd(graph, puzzle, "POL")).toBe(true);
  });
});

describe("challenge links", () => {
  const nameOf = (code: string) => countries.find((c) => c.code === code)?.name;
  const parse = (raw: string) => parseRouteParam(raw, graph, nameOf);

  it("reads a valid route in any case, with the shortest route and par", () => {
    const result = parse(" fra-Chn ");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.puzzle).toMatchObject({ start: "FRA", end: "CHN" });
    expect(result.puzzle.par).toBe(bfsDistances(graph, "FRA").get("CHN")! - 1);
    expect(routeParam(result.puzzle)).toBe("FRA-CHN");
  });

  it("explains every way a link can be wrong", () => {
    const reason = (raw: string) => {
      const r = parse(raw);
      return r.ok ? "ok" : r.reason;
    };
    expect(reason("")).toMatch(/^"" isn't a route/);
    expect(reason("FRANCE-CHINA")).toMatch(/isn't a route/);
    expect(reason("FRA_CHN")).toMatch(/isn't a route/);
    expect(reason("FRA-CHN-DEU")).toMatch(/isn't a route/);
    // Long values are cut short in the message (and React escapes it as text).
    expect(reason("<script>alert(1)</script>")).toMatch(/^"<script>alert\(1\)<\/script…" isn't a route/);
    expect(reason("XXX-CHN")).toBe("XXX isn't a code for one of the game's 195 countries.");
    expect(reason("FRA-TWN")).toBe("TWN isn't a code for one of the game's 195 countries."); // a territory, not one of the 195
    expect(reason("FRA-FRA")).toBe("The route starts and ends in France.");
    expect(reason("FRA-USA")).toBe("There's no land route from France to United States.");
    expect(reason("FRA-DEU")).toBe("France and Germany share a border, so there's nothing to name in between.");
  });

  it("refuses codes the game can't play even if the border data has them", () => {
    const r = parseRouteParam("FRA-CHN", graph, (code) => (code === "CHN" ? undefined : nameOf(code)));
    expect(r).toEqual({ ok: false, reason: "CHN isn't a code for one of the game's 195 countries." });
  });
});
