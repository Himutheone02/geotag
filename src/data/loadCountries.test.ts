import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import snapshot from "./countries.json";
import historicalEmpires from "./historical_empires.json";
import { EMPIRES, getSovereignStates, resolveEmpires, toSovereignStates, type RawCountry } from "./loadCountries";

const countries = toSovereignStates(snapshot as RawCountry[]);
const empires = resolveEmpires(countries);
const byCode = new Map(countries.map((c) => [c.code, c]));

describe("resolveEmpires", () => {
  it("resolves every listed name to a sovereign state, except Kosovo", () => {
    for (const e of empires) {
      const listed = (historicalEmpires as Record<string, string[]>)[EMPIRES.find((m) => m.key === e.key)!.dataKey];
      expect(e.codes.length + e.excluded.length).toBe(listed.length);
      expect(e.excluded.every((name) => name === "Kosovo")).toBe(true);
    }
    expect(empires.filter((e) => e.excluded.includes("Kosovo")).map((e) => e.key)).toEqual(["Roman", "Ottoman"]);
  });

  it("maps names through aliases (Turkey, The Gambia) to the right countries", () => {
    const roman = empires.find((e) => e.key === "Roman")!;
    const british = empires.find((e) => e.key === "British")!;
    expect(roman.codes).toContain("TUR");
    expect(british.codes).toContain("GMB");
    expect(empires.find((e) => e.key === "Mughal")!.codes.map((c) => byCode.get(c)!.name)).toEqual([
      "India",
      "Pakistan",
      "Bangladesh",
      "Afghanistan",
    ]);
  });

  it("has the expected round sizes", () => {
    expect(Object.fromEntries(empires.map((e) => [e.key, e.codes.length]))).toEqual({
      Roman: 43,
      Mughal: 4,
      Ottoman: 38,
      Soviet: 15,
      British: 66,
    });
  });
});

describe("getSovereignStates (the app's only country data)", () => {
  it("is the bundled snapshot's 195 sovereign states, sorted by name", () => {
    const states = getSovereignStates();
    expect(states).toHaveLength(195);
    expect(states).toEqual(toSovereignStates(snapshot as RawCountry[]));
    expect(states.map((c) => c.name)).toEqual([...states.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });

  it("never touches the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    getSovereignStates();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("offline-first guard", () => {
  /** Every non-test source file under src/. */
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it("no app code makes a network request", () => {
    const files = sourceFiles(path.join(process.cwd(), "src"));
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const code = readFileSync(file, "utf8");
      for (const call of ["fetch(", "XMLHttpRequest", "EventSource(", "WebSocket(", "sendBeacon("]) {
        expect(code.includes(call), `${path.relative(process.cwd(), file)} uses ${call}`).toBe(false);
      }
    }
  });
});
