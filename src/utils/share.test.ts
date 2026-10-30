import { describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { toSovereignStates, type RawCountry } from "@/data/loadCountries";
import { buildBorderGraph, type RoutePuzzle } from "./pathfinding";
import { buildShareText, formatShareTime, paceGrid, routeGrid } from "./share";

const graph = buildBorderGraph(toSovereignStates(snapshot as RawCountry[]));
// Portugal to Poland, 3 countries in between (Spain, France, Germany).
const puzzle: RoutePuzzle = { start: "PRT", end: "POL", par: 3, shortest: ["PRT", "ESP", "FRA", "DEU", "POL"] };

describe("routeGrid", () => {
  it("is all green for a shortest route, built from either end", () => {
    expect(routeGrid(graph, puzzle, ["ESP", "FRA", "DEU"])).toBe("🟩🟩🟩");
    expect(routeGrid(graph, puzzle, ["DEU", "ESP", "FRA"])).toBe("🟩🟩🟩");
  });

  it("marks a guess one crossing out of the way yellow, and dead ends or the wrong side red", () => {
    // Andorra: a route through it takes one crossing more. Russia and Italy: two or more.
    expect(routeGrid(graph, puzzle, ["ESP", "AND", "FRA", "DEU"])).toBe("🟩🟨🟩🟩");
    expect(routeGrid(graph, puzzle, ["RUS", "ESP", "ITA", "FRA", "DEU"])).toBe("🟥🟩🟥🟩🟩");
  });
});

describe("paceGrid", () => {
  it("colors each tenth of the countries by seconds per country", () => {
    // 20 countries: 2 per square. 4 s each, then 10 s each, then 20 s each.
    const times: number[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) times.push((t += i < 8 ? 4000 : i < 14 ? 10_000 : 20_000));
    expect(paceGrid(times, 20)).toBe("🟩🟩🟩🟩🟨🟨🟨🟥🟥🟥");
  });

  it("leaves unreached tenths white after a forfeit", () => {
    expect(paceGrid([1000, 2000, 3000], 20)).toBe("🟩⬜⬜⬜⬜⬜⬜⬜⬜⬜");
  });

  it("uses one square per country in rounds under 10", () => {
    expect(paceGrid([3000, 30_000], 4)).toBe("🟩🟥⬜⬜");
  });

  it("splits uneven rounds into 10 squares", () => {
    const times = Array.from({ length: 54 }, (_, i) => (i + 1) * 5000);
    expect([...paceGrid(times, 54)]).toHaveLength(10);
    expect(paceGrid(times, 54)).toBe("🟩".repeat(10));
  });
});

describe("buildShareText", () => {
  it("formats a daily route like the spec's example, with no country names", () => {
    const text = buildShareText({
      kind: "route",
      title: "Pathfinding",
      daily: "2026-10-26",
      won: true,
      moves: 5,
      par: 4,
      timeMs: 72_400,
      grid: "🟩🟩🟨🟩🟩",
      assisted: false,
    });
    expect(text).toBe("geotag - Daily Pathfinding 2026-10-26\n🗺️ 5 moves (shortest 4) ⏱️ 01:12\n🟩🟩🟨🟩🟩");
  });

  it("formats a forfeited name-them-all round with hints and suggestions", () => {
    const text = buildShareText({
      kind: "list",
      title: "Europe Capitals",
      emoji: "🏙️",
      daily: null,
      won: false,
      named: 31,
      total: 45,
      hints: 2,
      timeMs: 600_000,
      grid: "🟩🟩🟨🟨🟥🟥🟥⬜⬜⬜",
      assisted: true,
    });
    expect(text).toBe("geotag - Europe Capitals\n🏙️ 31/45 🏳️ ⏱️ 10:00 💡 2\n🟩🟩🟨🟨🟥🟥🟥⬜⬜⬜\n🔤 with suggestions");
  });

  it("says when a route was abandoned", () => {
    const text = buildShareText({ kind: "route", title: "Pathfinding", daily: null, won: false, moves: 1, par: 4, timeMs: 5000, grid: "🟥", assisted: false });
    expect(text.split("\n")[1]).toBe("🗺️ 🏳️ gave up after 1 move ⏱️ 00:05");
  });

  it("formats time like the in-game timer", () => {
    expect(formatShareTime(0)).toBe("00:00");
    expect(formatShareTime(3_599_999)).toBe("59:59");
  });
});
