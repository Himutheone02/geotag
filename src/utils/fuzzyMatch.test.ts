import { describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { EXPECTED_SOVEREIGN_COUNT, toSovereignStates, type RawCountry } from "@/data/loadCountries";
import {
  answerForInput,
  buildIndex,
  liveMatch,
  matchCountry,
  normalize,
  suggestCountries,
  type MatchResult,
} from "./fuzzyMatch";

const countries = toSovereignStates(snapshot as RawCountry[]);
const index = buildIndex(countries);
const match = (s: string, scope?: Set<string>) => matchCountry(s, index, { scope });
const code = (r: MatchResult) => (r.status === "match" ? r.country.code : r.status);

describe("dataset", () => {
  it("contains exactly the 193 UN members + 2 observer states", () => {
    expect(countries).toHaveLength(EXPECTED_SOVEREIGN_COUNT);
  });

  it("excludes territories and partially recognized states", () => {
    const codes = new Set(countries.map((c) => c.code));
    for (const c of ["GRL", "PRI", "HKG", "TWN", "UNK", "ESH", "GUM"]) expect(codes.has(c)).toBe(false);
  });

  it("every country's own display name resolves to itself", () => {
    const failures = countries.filter((c) => code(match(c.name)) !== c.code).map((c) => c.name);
    expect(failures).toEqual([]);
  });

  it("no normalized name or alias is shared by two countries", () => {
    const shared = [...index.exact].filter(([, codes]) => codes.length > 1);
    expect(shared).toEqual([]);
  });
});

describe("normalize", () => {
  it.each([
    ["Côte d’Ivoire", "cote divoire"],
    ["St. Lucia", "saint lucia"],
    ["Trinidad & Tobago", "trinidad and tobago"],
    ["  The   Gambia ", "gambia"],
    ["São Tomé and Príncipe", "sao tome and principe"],
    ["Türkiye", "turkiye"],
  ])("%s -> %s", (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("exact and alternate names", () => {
  it.each([
    ["France", "FRA"],
    ["france", "FRA"],
    ["Ivory Coast", "CIV"],
    ["cote d'ivoire", "CIV"],
    ["Burma", "MMR"],
    ["Holland", "NLD"],
    ["Czech Republic", "CZE"],
    ["Czechia", "CZE"],
    ["UK", "GBR"],
    ["USA", "USA"],
    ["us", "USA"],
    ["DRC", "COD"],
    ["Swaziland", "SWZ"],
    ["The Gambia", "GMB"],
    ["St Lucia", "LCA"],
    ["Trinidad & Tobago", "TTO"],
    ["East Timor", "TLS"],
    ["Vatican", "VAT"],
    ["Palestine", "PSE"],
    ["Nederland", "NLD"],
    ["Bundesrepublik Deutschland", "DEU"],
    ["Turkey", "TUR"],
    ["Türkiye", "TUR"],
    ["North Korea", "PRK"],
    ["South Korea", "KOR"],
  ])("%s -> %s", (input, expected) => {
    expect(code(match(input))).toBe(expected);
  });
});

describe("typos are forgiven", () => {
  it.each([
    ["Frnace", "FRA"],
    ["Brazl", "BRA"],
    ["Argentna", "ARG"],
    ["Phillipines", "PHL"],
    ["Kazakstan", "KAZ"],
    ["Kyrgystan", "KGZ"],
    ["Columbia", "COL"],
    ["Luxemburg", "LUX"],
    ["Liechtenstien", "LIE"],
    ["Mozambik", "MOZ"],
    ["Madagaskar", "MDG"],
    ["Ivory Cost", "CIV"],
    ["Bosnia Herzegovena", "BIH"],
    // Adjacent swaps on short names: these resolved to the WRONG country
    // (Uganda, Malawi, Malawi, Serbia, Switzerland) before swaps cost 1 edit.
    ["Hgana", "GHA"],
    ["Mlai", "MLI"],
    ["Malat", "MLT"],
    ["Sryia", "SYR"],
    ["Syira", "SYR"],
  ])("%s -> %s", (input, expected) => {
    expect(code(match(input))).toBe(expected);
  });
});

describe("near-neighbour countries are never confused", () => {
  it.each([
    ["Iran", "IRN"],
    ["Iraq", "IRQ"],
    ["Niger", "NER"],
    ["Nigeria", "NGA"],
    ["Austria", "AUT"],
    ["Australia", "AUS"],
    ["Gambia", "GMB"],
    ["Zambia", "ZMB"],
    ["Dominica", "DMA"],
    ["Dominican Republic", "DOM"],
    ["Guinea", "GIN"],
    ["Sudan", "SDN"],
    ["Slovakia", "SVK"],
    ["Slovenia", "SVN"],
    ["Mali", "MLI"],
    ["Malta", "MLT"],
  ])("%s -> %s", (input, expected) => {
    expect(code(match(input))).toBe(expected);
  });

  it.each([
    ["Irak", ["IRN", "IRQ"]],
    ["Nigera", ["NER", "NGA"]],
    ["Austrlia", ["AUS", "AUT"]],
    ["Xambia", ["GMB", "ZMB"]],
    ["Chine", ["CHL", "CHN"]],
    // One swap from Belize, one substitution from "Belgie" (a Belgium alias).
    ["Belzie", ["BEL", "BLZ"]],
  ])("%s is reported as ambiguous", (input, expected) => {
    const r = match(input);
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") expect(r.candidates.map((c) => c.code).sort()).toEqual(expected);
  });

  /**
   * Property check over the whole dataset: delete any one letter, or swap any
   * two adjacent letters, of any country name. The matcher may accept it,
   * call it ambiguous, or reject it, but it must never return a DIFFERENT country.
   */
  it("single deletions/transpositions never resolve to the wrong country", () => {
    const wrong: string[] = [];
    for (const c of countries) {
      const n = normalize(c.name);
      const variants = new Set<string>();
      for (let i = 0; i < n.length; i++) variants.add(n.slice(0, i) + n.slice(i + 1));
      for (let i = 0; i < n.length - 1; i++) variants.add(n.slice(0, i) + n[i + 1] + n[i] + n.slice(i + 2));
      variants.delete(n);
      for (const v of variants) {
        const r = match(v);
        if (r.status === "match" && r.country.code !== c.code && r.distance > 0) {
          wrong.push(`${c.name}: "${v}" -> ${r.country.name}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("rejections", () => {
  it.each(["in", "is", "no", "irn"])("short non-exact input %s is rejected", (input) => {
    expect(code(match(input))).toBe("no_match");
  });

  it.each(["Greenland", "Puerto Rico", "Taiwan", "Kosovo", "asdfgh", "Atlantis"])("%s is not accepted", (input) => {
    expect(code(match(input))).toBe("no_match");
  });

  it("empty input", () => {
    const r = match("   ");
    expect(r.status === "no_match" && r.reason).toBe("empty");
  });
});

describe("scoped rounds (e.g. one continent)", () => {
  const scopeOf = (region: string) => new Set(countries.filter((c) => c.region === region).map((c) => c.code));

  it("does not 'correct' an out-of-scope exact answer into an in-scope country", () => {
    const r = match("Austria", scopeOf("Oceania"));
    expect(r.status).toBe("out_of_scope");
  });

  it("uses scope to break a tie", () => {
    expect(code(match("Austrlia", scopeOf("Europe")))).toBe("AUT");
    expect(code(match("Austrlia", scopeOf("Oceania")))).toBe("AUS");
  });
});

describe("liveMatch (per-keystroke rules)", () => {
  const scopeOf = (region: string) => new Set(countries.filter((c) => c.region === region).map((c) => c.code));
  const live = (input: string, region: string, named: string[] = []) =>
    liveMatch(input, index, { scope: scopeOf(region), named: new Set(named) });
  const action = (input: string, region: string, named: string[] = []) => live(input, region, named).action;

  it("accepts a complete, unambiguous name on the keystroke", () => {
    expect(action("Kenya", "Africa")).toBe("accept");
  });

  it("holds a name that starts another unnamed country", () => {
    expect(action("Niger", "Africa")).toBe("hold"); // Nigeria
    expect(action("Guinea", "Africa")).toBe("hold"); // Guinea-Bissau
    expect(action("Dominica", "Americas")).toBe("hold"); // Dominican Republic
    expect(action("uk", "Europe")).toBe("hold"); // Ukraine
  });

  it("releases the hold once the longer country is already named", () => {
    expect(action("Niger", "Africa", ["NGA"])).toBe("accept");
  });

  it("never credits the shorter country partway through a longer name", () => {
    expect(action("nige", "Africa")).toBe("hold");
    expect(action("zimba", "Africa")).not.toMatch(/accept/);
    expect(action("turk", "Asia")).not.toMatch(/accept/);
  });

  it("waits for a pause before accepting typo-corrected or partial names", () => {
    expect(action("Kneya", "Africa")).toBe("acceptAfterPause");
    expect(action("Germa", "Europe")).toBe("acceptAfterPause");
    expect(action("Bosnia", "Europe")).toBe("acceptAfterPause"); // start of "Bosnia and Herzegovina"
    expect(action("Bosnia and Herzegovina", "Europe")).toBe("accept");
  });

  it("flags exact names that are already named", () => {
    expect(action("Kenya", "Africa", ["KEN"])).toBe("alreadyNamed");
  });

  it("ignores countries outside the round", () => {
    expect(action("France", "Africa")).toBe("none");
  });

  /** Type every country letter by letter in its own continent round. */
  it("typing any correct name never credits another country or cuts the word off", () => {
    const problems: string[] = [];
    for (const c of countries) {
      const text = normalize(c.name);
      for (let i = 1; i < text.length; i++) {
        const d = live(text.slice(0, i), c.region);
        if (d.action === "accept") {
          problems.push(`${c.name}: accepted ${d.country.name} at "${text.slice(0, i)}"`);
          break;
        }
      }
      const end = live(text, c.region);
      if (end.action !== "none" && end.action !== "alreadyNamed" && end.country.code !== c.code) {
        problems.push(`${c.name}: full name resolves to ${end.country.name}`);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("suggestCountries (autocomplete)", () => {
  const names = (q: string, options = {}) => suggestCountries(q, index, options).map((s) => s.country.name);
  const codesOf = (...ns: string[]) => new Set(ns.map((n) => countries.find((c) => c.name === n)!.code));

  it("lists display-name prefix matches first, alphabetically", () => {
    expect(names("b")).toEqual(["Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin"]);
    expect(names("br").slice(0, 2)).toEqual(["Brazil", "Brunei"]);
  });

  it("puts prefix matches strictly before alias, substring and fuzzy matches", () => {
    const order = { prefix: 0, alias: 1, substring: 2, fuzzy: 3 };
    for (const q of ["b", "br", "bur", "gu", "guinea", "an", "stan", "korea", "republic", "sa"]) {
      const tiers = suggestCountries(q, index, { limit: 50 }).map((s) => order[s.tier]);
      expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    }
  });

  it("explains alias matches", () => {
    const bur = suggestCountries("bur", index);
    expect(bur.map((s) => s.country.name)).toEqual(["Burkina Faso", "Burundi", "Myanmar"]);
    expect(bur[2]).toMatchObject({ tier: "alias", via: "Burma" });
    expect(suggestCountries("holl", index)[0]).toMatchObject({ tier: "alias", via: "Holland" });
  });

  it("needs two letters before offering alternate names", () => {
    const scope = new Set(countries.filter((c) => c.region === "Europe").map((c) => c.code));
    expect(names("b", { scope })).not.toContain("Germany"); // Bundesrepublik Deutschland
    expect(names("br", { scope })).toContain("United Kingdom"); // Britain
  });

  it("finds later words and parts of names", () => {
    expect(names("guinea")).toEqual(["Guinea", "Guinea-Bissau", "Equatorial Guinea", "Papua New Guinea"]);
    expect(names("stan")).toContain("Kazakhstan");
  });

  it("falls back to typo-tolerant prefixes only when nothing starts with the query", () => {
    expect(names("brzil")).toEqual(["Brazil"]);
    expect(names("nigerai")).toEqual(["Nigeria"]);
    expect(names("congo")).toEqual(["Congo", "DR Congo"]); // no Mongolia
  });

  it("only offers in-scope, un-named countries", () => {
    const scope = codesOf("Belgium", "Belarus", "Bulgaria", "Brazil");
    expect(names("b", { scope })).toEqual(["Belarus", "Belgium", "Brazil", "Bulgaria"]);
    expect(names("b", { scope, named: codesOf("Belgium") })).toEqual(["Belarus", "Brazil", "Bulgaria"]);
    expect(names("b", { scope, exclude: codesOf("Brazil") })).toEqual(["Belarus", "Belgium", "Bulgaria"]);
  });

  it("returns nothing for empty input and respects the limit", () => {
    expect(names("  ")).toEqual([]);
    expect(names("a", { limit: 3 })).toHaveLength(3);
  });
});

describe("capitals index (Capitals mode)", () => {
  const capitals = buildIndex(countries, "capitals");
  const cap = (s: string) => code(matchCountry(s, capitals));

  it("has a capital for all 195 countries, and each one resolves to its country", () => {
    expect(capitals.primary.size).toBe(195);
    const failures = countries.flatMap((c) => c.capitals.filter((name) => cap(name) !== c.code).map((name) => `${name} (${c.code})`));
    expect(failures).toEqual([]);
  });

  it("accepts every listed capital of multi-capital countries, and other spellings", () => {
    for (const name of ["Pretoria", "Cape Town", "Bloemfontein"]) expect(cap(name)).toBe("ZAF");
    expect(cap("La Paz")).toBe("BOL");
    expect(cap("Mbabane")).toBe("SWZ");
    expect(cap("Kiev")).toBe("UKR");
    expect(cap("Washington")).toBe("USA");
    expect(cap("DC")).toBe("USA");
    expect(cap("Ulan Bator")).toBe("MNG");
    expect(cap("Brasilia")).toBe("BRA");
    expect(cap("Nuku'alofa")).toBe("TON");
  });

  it("matches capitals only, not country names", () => {
    expect(cap("France")).toBe("no_match");
    expect(cap("Singapore")).toBe("SGP"); // a city-state's capital shares its name
  });

  it("keeps near-identical capitals apart", () => {
    expect(cap("Kingston")).toBe("JAM");
    expect(cap("Kingstown")).toBe("VCT");
    expect(cap("Nairbi")).toBe("KEN");
  });

  it("never credits the wrong country, or a capital before it's complete, while typing letter by letter", () => {
    const problems: string[] = [];
    for (const c of countries) {
      const scope = new Set(countries.filter((x) => x.region === c.region).map((x) => x.code));
      for (const name of c.capitals) {
        for (let i = 1; i <= name.length; i++) {
          const d = liveMatch(name.slice(0, i), capitals, { scope });
          if (d.action !== "accept") continue;
          if (d.country.code !== c.code || normalize(name.slice(0, i)) !== normalize(name)) problems.push(`${name} at "${name.slice(0, i)}"`);
          break;
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("names the capital the player meant", () => {
    expect(answerForInput(capitals, "ZAF", "cape twon")).toBe("Cape Town");
    expect(answerForInput(capitals, "ZAF", "pretoria")).toBe("Pretoria");
    expect(answerForInput(capitals, "UKR", "kiev")).toBe("Kyiv");
  });

  it("suggests capitals, labelled by the capital that matched", () => {
    expect(suggestCountries("kin", capitals).map((s) => s.label)).toEqual(["Kingston", "Kingstown", "Kinshasa"]);
    expect(suggestCountries("cape", capitals)[0]).toMatchObject({ label: "Cape Town", tier: "prefix" });
    expect(suggestCountries("kie", capitals)[0]).toMatchObject({ label: "Kyiv", via: "Kiev" });
  });
});
