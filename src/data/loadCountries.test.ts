import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import snapshot from "./countries.json";
import historicalEmpires from "./historical_empires.json";
import notesFile from "./historical_empire_notes.json";
import { EMPIRE_RULE, EMPIRES, getSovereignStates, resolveEmpires, toSovereignStates, type RawCountry } from "./loadCountries";

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
      Roman: 45,
      Mughal: 4,
      Ottoman: 37,
      Soviet: 17,
      British: 71,
    });
  });
});

describe("empire lists follow the inclusion rule (direct rule, any time in the era)", () => {
  const listOf = (key: string) => new Set(empires.find((e) => e.key === key)!.codes);
  const code = (name: string) => countries.find((c) => c.name === name)!.code;
  const has = (key: string, name: string) => listOf(key).has(code(name));

  it("drops countries the empire never governed", () => {
    expect(has("Roman", "Moldova")).toBe(false); // outside Roman Dacia
    for (const name of ["United Arab Emirates", "Oman", "Bahrain", "Kuwait"]) expect(has("Ottoman", name)).toBe(false);
  });

  it("drops protected states that kept their own rulers, and governments under a mandate or protectorate", () => {
    for (const name of ["Kuwait", "Bahrain", "Qatar", "United Arab Emirates", "Maldives", "Tonga", "Brunei", "Egypt", "Jordan", "Iraq"]) {
      expect(has("British", name)).toBe(false);
    }
  });

  it("adds countries where any part was directly governed", () => {
    for (const name of ["Ukraine", "Armenia", "Saudi Arabia"]) expect(has("Roman", name)).toBe(true);
    for (const name of ["Croatia", "Slovakia", "Iran"]) expect(has("Ottoman", name)).toBe(true);
    for (const name of ["Poland", "Finland"]) expect(has("Soviet", name)).toBe(true);
    for (const name of ["United States", "Mauritius", "Seychelles", "China", "Spain", "Germany", "France", "Morocco", "Oman"]) {
      expect(has("British", name)).toBe(true);
    }
  });

  it("explains every partial entry with a note, and only for countries on that list", () => {
    const british = empires.find((e) => e.key === "British")!;
    expect(british.notes[code("China")]).toBe("Hong Kong (1841–1997) and Weihaiwei (1898–1930)");
    expect(british.notes[code("Oman")]).toBe("The Khuriya Muriya Islands, 1854–1967");
    for (const empire of empires) {
      for (const noted of Object.keys(empire.notes)) expect(empire.codes).toContain(noted);
    }
    // Every note in the data file resolves (a misspelled name would silently lose its note).
    const total = Object.values(notesFile as Record<string, Record<string, string>>).reduce((n, notes) => n + Object.keys(notes).length, 0);
    expect(empires.reduce((n, e) => n + Object.keys(e.notes).length, 0)).toBe(total);
  });

  it("keeps the rule text short enough for the setup screen", () => {
    expect(EMPIRE_RULE.short.length + EMPIRE_RULE.detail.length).toBeLessThan(220);
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
