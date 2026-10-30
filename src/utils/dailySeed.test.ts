import { describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { toSovereignStates, type RawCountry } from "@/data/loadCountries";
import { CONTINENTS } from "@/app/CountryGuesser";
import {
  addDays,
  dailyGuessing,
  dailyPathfinding,
  dateKey,
  hashString,
  mulberry32,
  nextLocalMidnight,
  seededRandom,
  startOfLocalDay,
} from "./dailySeed";
import { bfsDistances, buildBorderGraph, MAX_PAR, MIN_PAR } from "./pathfinding";

const countries = toSovereignStates(snapshot as RawCountry[]);
const graph = buildBorderGraph(countries);

describe("mulberry32", () => {
  it("matches the widely used reference implementation", () => {
    // bryc's one-liner (github.com/bryc/code, PRNGs.md), the usual source for Mulberry32 in JS.
    function reference(a: number) {
      return function () {
        let t = (a += 0x6d2b79f5);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    for (const seed of [1, 42, hashString("2026-10-26")]) {
      const ours = mulberry32(seed);
      const theirs = reference(seed);
      for (let i = 0; i < 1000; i++) expect(ours()).toBe(theirs());
    }
    const random = mulberry32(1);
    expect([random(), random(), random()].map((x) => Math.round(x * 4294967296))).toEqual([2693262067, 11749833, 2265367787]);
  });

  it("stays in [0, 1) and is roughly uniform", () => {
    const random = mulberry32(hashString("2026-10-26"));
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 100_000; i++) {
      const x = random();
      expect(x >= 0 && x < 1).toBe(true);
      buckets[Math.floor(x * 10)]++;
    }
    for (const b of buckets) expect(Math.abs(b - 10_000)).toBeLessThan(500);
  });

  it("is repeatable per date and differs between dates", () => {
    const a = seededRandom("2026-10-26");
    const b = seededRandom("2026-10-26");
    const c = seededRandom("2026-10-27");
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
  });
});

describe("dateKey", () => {
  it("formats the local calendar date with zero padding", () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(dateKey(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("local midnight", () => {
  it("startOfLocalDay is setHours(0, 0, 0, 0) of the same day", () => {
    const at = new Date(2026, 9, 29, 15, 42, 7, 123).getTime();
    expect(startOfLocalDay(at)).toBe(new Date(2026, 9, 29).getTime());
    expect(startOfLocalDay(new Date(2026, 9, 29).getTime())).toBe(new Date(2026, 9, 29).getTime());
  });

  it("nextLocalMidnight is the start of the next calendar day", () => {
    expect(nextLocalMidnight(new Date(2026, 9, 29, 23, 59, 59, 999).getTime())).toBe(new Date(2026, 9, 30).getTime());
    expect(nextLocalMidnight(new Date(2026, 9, 29).getTime())).toBe(new Date(2026, 9, 30).getTime());
    expect(nextLocalMidnight(new Date(2026, 11, 31, 12).getTime())).toBe(new Date(2027, 0, 1).getTime());
  });

  it("stays on midnight across a daylight-saving change (any time zone)", () => {
    // Walk a year of days: the next midnight is always local 00:00:00 of the next date.
    for (let i = 0; i < 366; i++) {
      const noon = new Date(2026, 0, 1 + i, 12).getTime();
      const next = new Date(nextLocalMidnight(noon));
      expect([next.getHours(), next.getMinutes(), next.getSeconds()]).toEqual([0, 0, 0]);
      expect(dateKey(next)).toBe(dateKey(new Date(2026, 0, 2 + i)));
    }
  });

  it("addDays moves by calendar days", () => {
    expect(addDays("2026-10-29", 1)).toBe("2026-10-30");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2026-10-29", -365)).toBe("2025-10-29");
  });
});

describe("the two dailies", () => {
  it("are the same for the same date, even with the graph built in another order", () => {
    const reversed = buildBorderGraph([...countries].reverse());
    for (const date of ["2026-10-26", "2026-10-27", "2027-02-28", "2028-02-29"]) {
      expect(dailyPathfinding(date, reversed)).toEqual(dailyPathfinding(date, graph));
      expect(dailyGuessing(date, [...CONTINENTS].reverse())).toEqual(dailyGuessing(date, CONTINENTS));
    }
  });

  it("use separate seeds: the route and the continent don't share a random stream", () => {
    expect(seededRandom("guess:2026-10-29")()).not.toBe(seededRandom("route:2026-10-29")());
  });

  it("give a route every day, always in the difficulty band, and every continent comes up", () => {
    const pairs = new Set<string>();
    const continents = new Map<string, number>();
    for (let i = 0; i < 365; i++) {
      const date = dateKey(new Date(2026, 0, 1 + i));
      const route = dailyPathfinding(date, graph)!;
      expect(route.kind).toBe("pathfinding");
      const { start, end, par } = route.puzzle;
      expect(par).toBeGreaterThanOrEqual(MIN_PAR);
      expect(par).toBeLessThanOrEqual(MAX_PAR);
      expect(bfsDistances(graph, start).get(end)! - 1).toBe(par);
      pairs.add(`${start}-${end}`);
      const guessing = dailyGuessing(date, CONTINENTS);
      expect(guessing.kind).toBe("guessing");
      continents.set(guessing.continent, (continents.get(guessing.continent) ?? 0) + 1);
    }
    expect(pairs.size).toBeGreaterThan(365 * 0.9); // routes rarely repeat
    expect([...continents.keys()].sort()).toEqual([...CONTINENTS].sort());
    for (const n of continents.values()) expect(n).toBeGreaterThan(40);
  }, 30_000);
});
