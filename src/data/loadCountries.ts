// Server-only module: imported by the page (a Server Component), never by client code.
import snapshot from "./countries.json";
import historicalEmpires from "./historical_empires.json";
import { buildIndex, normalize, type Country } from "@/utils/fuzzyMatch";
import type { DailySource } from "@/utils/dailySeed";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** Shape of a country as returned by REST Countries v3.1 (only the fields we request). */
export type RawCountry = {
  name: { common: string; official: string };
  cca3: string;
  altSpellings?: string[];
  region?: string;
  subregion?: string;
  unMember?: boolean;
  /** Capital city or cities; most countries have one, South Africa three. */
  capital?: string[];
  borders?: string[];
  /** ISO numeric code; joins map shapes (world-atlas ids) to countries. Used by scripts/build-map.mjs. */
  ccn3?: string | null;
  /** [lat, lng] center point; used for small-country map markers. Used by scripts/build-map.mjs. */
  latlng?: [number, number] | null;
};

export type CountrySource = "rest-countries" | "snapshot";

/* ------------------------------------------------------------------ */
/* Curated aliases                                                     */
/* ------------------------------------------------------------------ */

/**
 * Curated alternate names, keyed by cca3.
 *
 * Why this exists: Levenshtein distance only forgives typos. Names like
 * "Ivory Coast" vs "Côte d'Ivoire" or "Burma" vs "Myanmar" are far apart in
 * edit distance, so they must be listed explicitly. REST Countries'
 * `altSpellings` covers some of these; this list fills the common gaps.
 *
 * Short aliases (3 characters or fewer after normalization) are matched
 * exactly only, never fuzzily, so "UK"/"US" are safe to include.
 */
export const CURATED_ALIASES: Record<string, string[]> = {
  ARE: ["UAE", "Emirates"],
  ATG: ["Antigua", "Antigua & Barbuda"],
  BHS: ["The Bahamas"],
  BIH: ["Bosnia", "Bosnia-Herzegovina", "Bosnia and Herzegovina"],
  BRN: ["Brunei Darussalam"],
  CIV: ["Ivory Coast", "Cote d'Ivoire"],
  COD: [
    "DRC",
    "DR Congo",
    "Democratic Republic of the Congo",
    "Democratic Republic of Congo",
    "Congo-Kinshasa",
    "Zaire",
  ],
  COG: ["Republic of the Congo", "Republic of Congo", "Congo-Brazzaville"],
  CPV: ["Cape Verde", "Cabo Verde"],
  CZE: ["Czech Republic", "Czechia"],
  FSM: ["Micronesia", "Federated States of Micronesia"],
  GBR: ["UK", "Britain", "Great Britain", "United Kingdom"],
  GMB: ["The Gambia"],
  KNA: ["Saint Kitts", "St Kitts and Nevis", "Saint Kitts and Nevis"],
  KOR: ["South Korea", "Republic of Korea"],
  LAO: ["Laos", "Lao PDR"],
  LCA: ["Saint Lucia"],
  MDA: ["Moldova"],
  MKD: ["Macedonia", "North Macedonia"],
  MMR: ["Burma", "Myanmar"],
  NLD: ["Holland", "The Netherlands"],
  PNG: ["PNG", "Papua New Guinea"],
  PRK: ["North Korea", "DPRK"],
  PSE: ["Palestine", "State of Palestine"],
  RUS: ["Russian Federation"],
  STP: ["Sao Tome", "Sao Tome and Principe"],
  SWZ: ["Swaziland", "Eswatini"],
  SYR: ["Syrian Arab Republic"],
  TLS: ["East Timor", "Timor-Leste"],
  TTO: ["Trinidad", "Trinidad & Tobago"],
  TUR: ["Turkey", "Turkiye", "Türkiye"],
  TZA: ["Tanzania"],
  USA: ["USA", "US", "America", "United States of America"],
  VAT: ["Vatican", "Vatican City", "Holy See"],
  VCT: ["Saint Vincent", "Saint Vincent and the Grenadines", "St Vincent and the Grenadines"],
  VNM: ["Viet Nam"],
};

/**
 * Capitals that replace the data's list (first = the one shown). Used where the
 * data names only one of several cities a country itself treats as capital.
 */
export const CAPITAL_OVERRIDES: Record<string, string[]> = {
  BOL: ["Sucre", "La Paz"], // constitutional capital; seat of government
  LKA: ["Sri Jayawardenepura Kotte", "Colombo"], // legislative capital; executive and commercial capital
  MNG: ["Ulaanbaatar"], // the data spells it "Ulan Bator" (kept as an alias)
  PSE: ["Ramallah", "East Jerusalem"], // administrative seat; proclaimed capital
  SWZ: ["Mbabane", "Lobamba"], // executive capital; royal and legislative capital
};

/** Other spellings and names accepted for a capital (never shown as the answer). */
export const CAPITAL_ALIASES: Record<string, string[]> = {
  CHE: ["Berne"],
  CHN: ["Peking"],
  GTM: ["Guatemala", "Ciudad de Guatemala"],
  IND: ["Delhi"],
  KAZ: ["Nur-Sultan"],
  KIR: ["Tarawa"],
  KWT: ["Kuwait"],
  LKA: ["Kotte"],
  MDA: ["Chisinau", "Kishinev"],
  MEX: ["Ciudad de Mexico", "CDMX"],
  MMR: ["Nay Pyi Taw", "Naypyitaw"],
  MNG: ["Ulan Bator"],
  PAN: ["Panama", "Ciudad de Panama"],
  SMR: ["San Marino"],
  UKR: ["Kiev"],
  USA: ["Washington", "Washington DC", "DC"],
  VAT: ["Vatican"],
  VNM: ["Ha Noi"],
};

/* ------------------------------------------------------------------ */
/* Sovereignty filter and normalization into Country records          */
/* ------------------------------------------------------------------ */

/**
 * Definition of "modern sovereign state" used by this app:
 * the 193 UN member states + the 2 UN observer states (Vatican City, Palestine) = 195.
 *
 * This is a policy choice, not a fact in the data. REST Countries returns ~250
 * entries including territories (Greenland, Puerto Rico, Hong Kong...), and its
 * `independent` flag disagrees with the UN list in a few places. Taiwan and
 * Kosovo are excluded under this rule; add their cca3 codes here to include them.
 */
export const UN_OBSERVER_STATES = new Set(["VAT", "PSE"]);
export const EXPECTED_SOVEREIGN_COUNT = 195;

export function isSovereign(c: RawCountry): boolean {
  return c.unMember === true || UN_OBSERVER_STATES.has(c.cca3);
}

/**
 * REST Countries `altSpellings` mixes real alternate names ("Deutschland",
 * "Ivory Coast") with ISO codes ("DE", "CI"). Two-letter codes are dropped:
 * accepting "in", "is", "no", "me" as answers would be absurd in a quiz.
 */
function usableAltSpelling(alt: string): boolean {
  const n = normalize(alt);
  return n.length > 2;
}

export function toCountry(raw: RawCountry): Country {
  const aliases = new Set<string>();
  for (const alt of raw.altSpellings ?? []) {
    if (usableAltSpelling(alt)) aliases.add(alt);
  }
  for (const alias of CURATED_ALIASES[raw.cca3] ?? []) aliases.add(alias);

  const capitals = CAPITAL_OVERRIDES[raw.cca3] ?? (raw.capital ?? []).filter((c) => c.trim());
  const capitalAliases = (CAPITAL_ALIASES[raw.cca3] ?? []).filter((a) => !capitals.includes(a));
  // Live data may still spell a capital the old way: keep whatever it says as an alias.
  for (const c of raw.capital ?? []) if (!capitals.includes(c) && !capitalAliases.includes(c)) capitalAliases.push(c);

  return {
    code: raw.cca3,
    name: raw.name.common,
    official: raw.name.official,
    region: raw.region ?? "",
    subregion: raw.subregion ?? "",
    borders: raw.borders ?? [],
    aliases: [...aliases],
    capitals,
    capitalAliases,
  };
}

export function toSovereignStates(raw: RawCountry[]): Country[] {
  return raw
    .filter(isSovereign)
    .map(toCountry)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Basic shape check so a malformed API response never reaches the UI. */
export function looksLikeCountryList(data: unknown): data is RawCountry[] {
  return (
    Array.isArray(data) &&
    data.length >= 190 &&
    data.every(
      (c) =>
        c &&
        typeof c === "object" &&
        typeof (c as RawCountry).cca3 === "string" &&
        typeof (c as RawCountry).name?.common === "string",
    )
  );
}

/* ------------------------------------------------------------------ */
/* REST Countries fetch with snapshot fallback                         */
/* ------------------------------------------------------------------ */

/**
 * REST Countries requires an explicit `fields` list on /all (max 10 fields),
 * otherwise it returns 400 Bad Request.
 */
export const REST_COUNTRIES_URL =
  "https://restcountries.com/v3.1/all?fields=" +
  ["name", "cca3", "altSpellings", "region", "subregion", "unMember", "capital", "borders"].join(",");

const ONE_DAY_SECONDS = 60 * 60 * 24;
const FETCH_TIMEOUT_MS = 5000;

export type CountryLoad = {
  countries: Country[];
  source: CountrySource;
  error?: string;
};

/**
 * Loads all sovereign states.
 *
 * Primary: REST Countries, cached by Next.js for 24h (country lists change rarely).
 * Fallback: the bundled snapshot (countries.json), used whenever the API is down,
 * slow, or returns something malformed. The free hosted API has no SLA, so the
 * game must never depend on it being up.
 */
export async function getSovereignStates(): Promise<CountryLoad> {
  try {
    const res = await fetch(REST_COUNTRIES_URL, {
      next: { revalidate: ONE_DAY_SECONDS },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`REST Countries responded ${res.status}`);
    const data: unknown = await res.json();
    if (!looksLikeCountryList(data)) throw new Error("Unexpected response shape");
    return { countries: toSovereignStates(data), source: "rest-countries" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[countries] Falling back to snapshot: ${message}`);
    return {
      countries: toSovereignStates(snapshot as RawCountry[]),
      source: "snapshot",
      error: message,
    };
  }
}

/* ------------------------------------------------------------------ */
/* Historical empires                                                  */
/* ------------------------------------------------------------------ */

/** Display metadata for each empire in historical_empires.json, in tile order. */
export const EMPIRES = [
  { key: "Roman", dataKey: "Roman_Empire", title: "Roman Empire", era: "27 BC – AD 476" },
  { key: "Mughal", dataKey: "Mughal_Empire", title: "Mughal Empire", era: "1526 – 1857" },
  { key: "Ottoman", dataKey: "Ottoman_Empire", title: "Ottoman Empire", era: "1299 – 1922" },
  { key: "Soviet", dataKey: "Soviet_Union", title: "Soviet Union", era: "1922 – 1991" },
  { key: "British", dataKey: "British_Empire", title: "British Empire", era: "1583 – 1997" },
] as const;

export type EmpireKey = (typeof EMPIRES)[number]["key"];

export type EmpireRound = {
  key: EmpireKey;
  title: string;
  era: string;
  /** cca3 codes of the listed countries that are sovereign states in this app. */
  codes: string[];
  /** Listed names that aren't one of the 195 sovereign states (Kosovo), so they can't be targets. */
  excluded: string[];
};

/**
 * Turns the empire lists (country names) into cca3 codes.
 * Names must match a country name or alias exactly (after normalization):
 * no fuzzy matching, so a typo in the data file can't silently map to the wrong country.
 */
export function resolveEmpires(countries: Country[]): EmpireRound[] {
  const index = buildIndex(countries);
  const lists = historicalEmpires as Record<string, string[]>;
  return EMPIRES.map((empire) => {
    const codes: string[] = [];
    const excluded: string[] = [];
    for (const name of lists[empire.dataKey] ?? []) {
      const match = index.exact.get(normalize(name));
      if (match?.length === 1) {
        if (!codes.includes(match[0])) codes.push(match[0]);
      } else {
        excluded.push(name);
      }
    }
    return { key: empire.key, title: empire.title, era: empire.era, codes, excluded };
  });
}

/**
 * The Daily Challenge's data: codes, continents and borders of the 195
 * sovereign states from the bundled snapshot (countries.json), never from the
 * live API, so every player draws the same puzzle on the same date.
 */
export function getDailySource(): DailySource {
  return toSovereignStates(snapshot as RawCountry[])
    .map(({ code, region, borders }) => ({ code, region, borders }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
