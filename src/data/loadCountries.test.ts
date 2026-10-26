import { describe, expect, it, vi } from "vitest";
import snapshot from "./countries.json";
import historicalEmpires from "./historical_empires.json";
import { EMPIRES, getDailySource, resolveEmpires, toSovereignStates, type RawCountry } from "./loadCountries";

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

describe("getDailySource (Daily Challenge data)", () => {
  it("is the bundled snapshot's 195 sovereign states, sorted by code, with borders and continents", () => {
    const source = getDailySource();
    expect(source).toHaveLength(195);
    const codes = source.map((c) => c.code);
    expect(codes).toEqual([...codes].sort());
    const fromSnapshot = new Map(toSovereignStates(snapshot as RawCountry[]).map((c) => [c.code, c]));
    for (const c of source) {
      expect(c.borders).toEqual(fromSnapshot.get(c.code)!.borders);
      expect(c.region).toBe(fromSnapshot.get(c.code)!.region);
    }
  });

  it("never touches the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    getDailySource();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
