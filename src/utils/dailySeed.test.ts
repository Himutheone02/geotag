import { describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { toSovereignStates, type RawCountry } from "@/data/loadCountries";
import { CONTINENTS } from "@/app/CountryGuesser";
import { dailyChallenge, dateKey, hashString, mulberry32, seededRandom } from "./dailySeed";
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

describe("dailyChallenge", () => {
  it("gives the same challenge for the same date, even with the graph built in another order", () => {
    const reversed = buildBorderGraph([...countries].reverse());
    for (const date of ["2026-10-26", "2026-10-27", "2027-02-28", "2028-02-29"]) {
      expect(dailyChallenge(date, reversed, CONTINENTS)).toEqual(dailyChallenge(date, graph, CONTINENTS));
    }
  });

  it("mixes routes and continents across a year, routes always in the difficulty band", () => {
    const kinds = { pathfinding: 0, continent: 0 };
    const pairs = new Set<string>();
    const day = new Date(2026, 0, 1);
    for (let i = 0; i < 365; i++) {
      const date = dateKey(new Date(day.getFullYear(), day.getMonth(), day.getDate() + i));
      const challenge = dailyChallenge(date, graph, CONTINENTS);
      kinds[challenge.kind]++;
      if (challenge.kind === "pathfinding") {
        const { start, end, par } = challenge.puzzle;
        expect(par).toBeGreaterThanOrEqual(MIN_PAR);
        expect(par).toBeLessThanOrEqual(MAX_PAR);
        expect(bfsDistances(graph, start).get(end)! - 1).toBe(par);
        pairs.add(`${start}-${end}`);
      } else {
        expect(CONTINENTS).toContain(challenge.continent);
      }
    }
    expect(kinds.pathfinding).toBeGreaterThan(140);
    expect(kinds.continent).toBeGreaterThan(140);
    expect(pairs.size).toBeGreaterThan(kinds.pathfinding * 0.9); // routes rarely repeat
  }, 30_000);
});
