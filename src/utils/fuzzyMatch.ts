import { distance } from "fastest-levenshtein";

/** Normalized country record the matcher works with. */
export type Country = {
  code: string; // ISO 3166-1 alpha-3 (cca3)
  name: string; // display name (name.common)
  official: string;
  region: string;
  subregion: string;
  borders: string[]; // cca3 codes; kept for hint stage 1 and border pathfinding later
  aliases: string[]; // alternate names accepted as answers (raw, un-normalized)
  /** Capital city or cities, the one to show first. Answers in Capitals mode. */
  capitals: string[];
  /** Other accepted spellings of the capital ("Kiev", "Peking"). */
  capitalAliases: string[];
};

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

// Letters that Unicode NFD does not decompose into base + accent.
const SPECIAL_LETTERS: Record<string, string> = {
  ø: "o",
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ł: "l",
  đ: "d",
  ı: "i",
  þ: "th",
};

/**
 * Canonical form used for every comparison:
 * lowercase, accents stripped, "&" -> "and", "St" -> "saint",
 * apostrophes dropped, punctuation -> spaces, leading "the" removed.
 *
 *   "Côte d’Ivoire"      -> "cote divoire"
 *   "St. Lucia"          -> "saint lucia"
 *   "Trinidad & Tobago"  -> "trinidad and tobago"
 *   "The Gambia"         -> "gambia"
 */
export function normalize(input: string): string {
  let s = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[øæœßłđıþ]/g, (ch) => SPECIAL_LETTERS[ch] ?? ch);
  s = s.replace(/&/g, " and ");
  s = s.replace(/['’‘`ʻ]/g, "");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/\bst\b/g, "saint");
  s = s.replace(/^the /, "");
  return s.replace(/\s+/g, " ");
}

/* ------------------------------------------------------------------ */
/* Tolerance policy                                                    */
/* ------------------------------------------------------------------ */

/**
 * Maximum edits forgiven for a candidate name of a given (normalized) length.
 * Short names get little or no tolerance because short country names sit
 * very close together (Iran/Iraq, Mali/Malta, Chad/Chile).
 */
export function maxEditsFor(length: number): number {
  if (length <= 3) return 0; // codes like "uk", "usa", "drc": exact only
  if (length <= 5) return 1;
  if (length <= 9) return 2;
  return 3;
}

/** True when b is a with exactly one pair of adjacent letters swapped ("mlai" / "mali"). */
function isAdjacentSwap(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (i >= a.length - 1) return false;
  return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
}

/**
 * Levenshtein distance (fastest-levenshtein), except that a single swap of two
 * adjacent letters costs 1 instead of 2. Swaps are the most common typing
 * error; plain Levenshtein scores "mlai" as 2 edits from Mali but also 2 from
 * Malawi, which let the wrong country win.
 */
export function typoDistance(a: string, b: string): number {
  return isAdjacentSwap(a, b) ? 1 : distance(a, b);
}

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */

/** What the player names: countries, or their capitals (Capitals mode). */
export type AnswerKind = "countries" | "capitals";

export type CountryIndex = {
  answer: AnswerKind;
  byCode: Map<string, Country>;
  /** every unique (normalized key, country code) pair */
  entries: { key: string; code: string }[];
  /** normalized key -> codes (more than one code means the key itself is ambiguous) */
  exact: Map<string, string[]>;
  /** code -> keys that are a displayed answer (the country's name, or each of its capitals), not an alias */
  labelKeys: Map<string, Set<string>>;
  /** normalized key -> the text it came from ("burma" -> "Burma") */
  display: Map<string, string>;
  /** code -> the answer to show for it ("Kenya", or "Nairobi" in Capitals mode) */
  primary: Map<string, string>;
};

/** The answers to show for a country, then the other accepted names. */
function answersOf(c: Country, answer: AnswerKind): { labels: string[]; others: string[] } {
  return answer === "capitals"
    ? { labels: c.capitals, others: c.capitalAliases }
    : { labels: [c.name], others: [c.official, ...c.aliases] };
}

/**
 * Index of every accepted answer. By default the answers are country names and
 * their aliases; with answer = "capitals", the capital cities instead, so the same
 * matcher, live-typing rules and autocomplete work unchanged in Capitals mode.
 */
export function buildIndex(countries: Country[], answer: AnswerKind = "countries"): CountryIndex {
  const byCode = new Map<string, Country>();
  const exact = new Map<string, string[]>();
  const entries: { key: string; code: string }[] = [];
  const labelKeys = new Map<string, Set<string>>();
  const display = new Map<string, string>();
  const primary = new Map<string, string>();

  for (const c of countries) {
    byCode.set(c.code, c);
    const { labels, others } = answersOf(c, answer);
    if (labels.length === 0) continue; // no capital on record: can't be answered in Capitals mode
    primary.set(c.code, labels[0]);
    labelKeys.set(c.code, new Set(labels.map(normalize).filter((k) => k.length > 0)));
    for (const raw of [...labels, ...others]) {
      const key = normalize(raw);
      if (key && !display.has(key)) display.set(key, raw);
    }
    const keys = new Set([...labels, ...others].map(normalize).filter((k) => k.length > 0));
    for (const key of keys) {
      entries.push({ key, code: c.code });
      const codes = exact.get(key);
      if (codes) {
        if (!codes.includes(c.code)) codes.push(c.code);
      } else {
        exact.set(key, [c.code]);
      }
    }
  }
  return { answer, byCode, entries, exact, labelKeys, display, primary };
}

/** The answer to show for a country in this index: its name, or its (first) capital. */
export function answerLabel(index: CountryIndex, code: string): string {
  return index.primary.get(code) ?? index.byCode.get(code)?.name ?? code;
}

/**
 * The displayed answer the player meant, for a country they were credited with:
 * "cape twon" -> "Cape Town" (South Africa has three capitals), "kiev" -> "Kyiv".
 */
export function answerForInput(index: CountryIndex, code: string, rawInput: string): string {
  const keys = index.labelKeys.get(code);
  if (!keys || keys.size <= 1) return answerLabel(index, code);
  const input = normalize(rawInput);
  let best: string | null = null;
  let bestDistance = Infinity;
  for (const key of keys) {
    const d = typoDistance(input, key);
    if (d < bestDistance) [best, bestDistance] = [key, d];
  }
  // An alias ("Tshwane"-style) far from every label falls back to the first capital.
  return best !== null && bestDistance <= maxEditsFor(best.length) ? index.display.get(best)! : answerLabel(index, code);
}

/** The displayed answer a matched key stands for: "cape town" -> "Cape Town", "kiev" -> "Kyiv". */
export function labelForKey(index: CountryIndex, code: string, key: string): string {
  return index.labelKeys.get(code)?.has(key) ? (index.display.get(key) ?? answerLabel(index, code)) : answerLabel(index, code);
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

export type MatchResult =
  | {
      status: "match";
      input: string;
      country: Country;
      distance: number; // 0 = exact (after normalization)
      matchedKey: string;
    }
  | {
      status: "ambiguous";
      input: string;
      candidates: Country[];
      distance: number;
    }
  | {
      status: "out_of_scope";
      input: string;
      country: Country;
      distance: number;
    }
  | {
      status: "no_match";
      input: string;
      reason: "empty" | "too_short" | "not_found";
    };

export type MatchOptions = {
  /**
   * Restrict which countries count as correct (e.g. one continent).
   * Matching still runs against the whole world first, so "Austria" typed in
   * an Oceania round is reported as out_of_scope instead of being "corrected"
   * to Australia. Scope is only used to break ties.
   */
  scope?: ReadonlySet<string>;
};

type Ranked = { code: string; distance: number; key: string };

/**
 * Fuzzy Input Recognition.
 *
 * 1. Normalize the input.
 * 2. Exact hit on a name/alias wins outright (so "Niger" never becomes "Nigeria").
 * 3. Otherwise score every name/alias with typoDistance (Levenshtein, with an
 *    adjacent swap counted as 1 edit), keeping only those within the
 *    length-scaled tolerance, and take each country's best.
 * 4. If the closest distance is shared by two or more countries, refuse to
 *    guess and report "ambiguous" (e.g. "Irak" is 1 edit from Iran AND Iraq).
 */
export function matchCountry(
  rawInput: string,
  index: CountryIndex,
  options: MatchOptions = {},
): MatchResult {
  const input = normalize(rawInput);
  if (!input) return { status: "no_match", input: rawInput, reason: "empty" };

  const { scope } = options;
  const inScope = (code: string) => !scope || scope.has(code);

  let ranked: Ranked[];
  const exactCodes = index.exact.get(input);

  if (exactCodes) {
    ranked = exactCodes.map((code) => ({ code, distance: 0, key: input }));
  } else {
    if (input.length <= 3) {
      return { status: "no_match", input: rawInput, reason: "too_short" };
    }
    const best = new Map<string, Ranked>();
    for (const { key, code } of index.entries) {
      const max = maxEditsFor(key.length);
      if (max === 0) continue;
      if (Math.abs(key.length - input.length) > max) continue; // cheap prefilter
      const d = typoDistance(input, key);
      if (d > max) continue;
      const prev = best.get(code);
      if (!prev || d < prev.distance) best.set(code, { code, distance: d, key });
    }
    ranked = [...best.values()].sort((a, b) => a.distance - b.distance);
  }

  if (ranked.length === 0) {
    return { status: "no_match", input: rawInput, reason: "not_found" };
  }

  const topDistance = ranked[0].distance;
  let tied = ranked.filter((r) => r.distance === topDistance);

  // Scope may break a tie (e.g. "Austrlia" in a Europe round -> Austria),
  // but never overrides a strictly closer out-of-scope country.
  if (tied.length > 1 && scope) {
    const scoped = tied.filter((r) => inScope(r.code));
    if (scoped.length > 0) tied = scoped;
  }

  if (tied.length > 1) {
    return {
      status: "ambiguous",
      input: rawInput,
      distance: topDistance,
      candidates: tied.map((r) => index.byCode.get(r.code)!),
    };
  }

  const winner = tied[0];
  const country = index.byCode.get(winner.code)!;
  if (!inScope(winner.code)) {
    return { status: "out_of_scope", input: rawInput, country, distance: winner.distance };
  }
  return {
    status: "match",
    input: rawInput,
    country,
    distance: winner.distance,
    matchedKey: winner.key,
  };
}

/* ------------------------------------------------------------------ */
/* Live (per-keystroke) acceptance guard                               */
/* ------------------------------------------------------------------ */

/**
 * True when the input could still be the start of a DIFFERENT country's name,
 * so auto-accepting `code` on this keystroke might cut off a longer answer:
 *   "niger"  -> the player may be typing "nigeria"
 *   "austr"  -> fuzzy-matches Austria, but is also the start of "australia"
 *
 * - Exact matches (fuzzy = false) are held only for exact prefixes.
 * - Fuzzy matches (fuzzy = true) are also held when the input is one typo away
 *   from the start of another name ("austrl" vs "austra").
 *
 * Countries in `ignore` (already named) never hold anything back.
 */
export function mayBePrefixOfAnother(
  rawInput: string,
  index: CountryIndex,
  code: string,
  fuzzy: boolean,
  ignore?: ReadonlySet<string>,
): boolean {
  const input = normalize(rawInput);
  const n = input.length;
  if (n === 0) return false;

  for (const { key, code: other } of index.entries) {
    if (other === code || key.length <= n || ignore?.has(other)) continue;
    if (key.startsWith(input)) return true;
    if (fuzzy && n >= 4) {
      if (typoDistance(input, key.slice(0, n)) <= 1) return true;
      if (typoDistance(input, key.slice(0, n + 1)) <= 1) return true;
    }
  }
  return false;
}

export type LiveDecision =
  /** Exact, complete name or alias, and not the start of any longer name: accept on this keystroke. */
  | { action: "accept"; country: Country; distance: 0 }
  /** Typo-corrected match, or a name that starts a longer name of the same country: accept once the player pauses. */
  | { action: "acceptAfterPause"; country: Country; distance: number }
  /** Could still be the start of another country's name: wait for more letters or Enter. */
  | { action: "hold"; country: Country; distance: number }
  /** Exact name of a country that's already been named. */
  | { action: "alreadyNamed"; country: Country }
  | { action: "none" };

/**
 * Decides what a game should do with the text after each keystroke.
 * Wraps matchCountry with two live-typing rules:
 *  1. Never accept while the input could be the start of another unnamed
 *     country (mayBePrefixOfAnother). Literal per-keystroke acceptance credits
 *     Niger while typing "Nigeria" and the UK at "uk" while typing "Ukraine".
 *  2. Accept exact matches instantly, but typo-corrected matches only after a
 *     pause: "germa" is already within 2 edits of Germany, so accepting it
 *     instantly would cut the word off and leave "ny" in the cleared field.
 */
export function liveMatch(
  rawInput: string,
  index: CountryIndex,
  options: { scope?: ReadonlySet<string>; named?: ReadonlySet<string> } = {},
): LiveDecision {
  const { scope, named } = options;
  const result = matchCountry(rawInput, index, { scope });
  if (result.status !== "match") return { action: "none" };

  const { country, distance } = result;
  if (named?.has(country.code)) {
    return distance === 0 && !mayBePrefixOfAnother(rawInput, index, country.code, false, named)
      ? { action: "alreadyNamed", country }
      : { action: "none" };
  }
  if (mayBePrefixOfAnother(rawInput, index, country.code, distance > 0, named)) {
    return { action: "hold", country, distance };
  }
  // The country's own display name is a complete answer: accept it now.
  // A shorter alias that starts a longer name ("bosnia" -> "bosnia and herzegovina")
  // may still be mid-word, so it waits for the pause instead of cutting the player off.
  const input = normalize(rawInput);
  if (distance === 0 && (index.labelKeys.get(country.code)?.has(input) || !startsLongerNameOf(input, index, country.code))) {
    return { action: "accept", country, distance: 0 };
  }
  return { action: "acceptAfterPause", country, distance };
}

function startsLongerNameOf(input: string, index: CountryIndex, code: string): boolean {
  return index.entries.some((e) => e.code === code && e.key.length > input.length && e.key.startsWith(input));
}

/* ------------------------------------------------------------------ */
/* Autocomplete suggestions                                            */
/* ------------------------------------------------------------------ */

export type SuggestionTier = "prefix" | "alias" | "substring" | "fuzzy";

export type Suggestion = {
  country: Country;
  tier: SuggestionTier;
  /** The answer to show: the country's name, or in Capitals mode the capital that matched ("Cape Town"). */
  label: string;
  /** The alternate name the query matched, when it isn't the displayed answer ("Burma" for Myanmar). */
  via?: string;
};

export type SuggestOptions = {
  /** Only these countries are offered (the round's targets, or the current country's neighbours). */
  scope?: ReadonlySet<string>;
  /** Already-named countries are never offered. */
  named?: ReadonlySet<string>;
  /** Never offered either (the country you're standing in, in pathfinding). */
  exclude?: ReadonlySet<string>;
  limit?: number;
};

const TIER_ORDER: Record<SuggestionTier, number> = { prefix: 0, alias: 1, substring: 2, fuzzy: 3 };

/** Alphabetical order that doesn't depend on the browser's locale (accents sort as their base letter). */
function compareText(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  return na < nb ? -1 : na > nb ? 1 : 0;
}

/**
 * Ranked autocomplete list for a partial answer. Strict tier order:
 *  1. prefix    – the display name starts with the query ("b" -> Bahamas, Bahrain, Bangladesh…)
 *  2. alias     – another accepted name starts with it, from 2 letters ("bur" -> Myanmar, via Burma)
 *  3. substring – a later word, or (3+ letters) any part, contains it ("guinea" -> Equatorial Guinea)
 *  4. fuzzy     – typo fallback, only when nothing starts with the query (5+ letters: "brzil" -> Brazil)
 * Alphabetical within prefix/alias/substring; closest first within fuzzy.
 */
export function suggestCountries(rawQuery: string, index: CountryIndex, options: SuggestOptions = {}): Suggestion[] {
  const { scope, named, exclude, limit = 8 } = options;
  const query = normalize(rawQuery);
  if (!query) return [];
  const n = query.length;

  type Hit = { tier: SuggestionTier; rank: number; key: string };
  const best = new Map<string, Hit>();
  const fuzzy = new Map<string, Hit>();
  const offer = (into: Map<string, Hit>, code: string, hit: Hit) => {
    const prev = into.get(code);
    if (!prev || TIER_ORDER[hit.tier] < TIER_ORDER[prev.tier] || (prev.tier === hit.tier && hit.rank < prev.rank)) {
      into.set(code, hit);
    }
  };

  for (const { key, code } of index.entries) {
    if ((scope && !scope.has(code)) || named?.has(code) || exclude?.has(code)) continue;
    const isName = index.labelKeys.get(code)?.has(key) ?? false;

    if (key.startsWith(query)) {
      if (isName) offer(best, code, { tier: "prefix", rank: 0, key });
      // One letter is too little to go on for alternate names ("b" -> Germany, as Bundesrepublik).
      // Among aliases, the shortest reads best ("Burma", not "Union of Burma").
      else if (n >= 2) offer(best, code, { tier: "alias", rank: key.length, key });
      continue;
    }
    if (n >= 2) {
      const at = key.indexOf(query);
      const wordStart = at > 0 && key[at - 1] === " ";
      // Mid-word hits only count in display names ("stan" -> Pakistan), not in
      // native-language aliases, where they're mostly noise.
      if (wordStart || (at > 0 && n >= 3 && isName)) {
        offer(best, code, { tier: "substring", rank: (wordStart ? 0 : 2) + (isName ? 0 : 1), key });
        continue;
      }
    }
    if (n >= 5) {
      let d = Infinity;
      for (const len of [n - 1, n, n + 1]) {
        if (len <= key.length) d = Math.min(d, typoDistance(query, key.slice(0, len)));
      }
      if (d <= maxEditsFor(n)) offer(fuzzy, code, { tier: "fuzzy", rank: d * 2 + (isName ? 0 : 1), key });
    }
  }

  // Typo matches are a fallback: once anything starts with the query, they're just noise
  // ("congo" doesn't need Mongolia).
  const startsSomething = [...best.values()].some((h) => h.tier === "prefix" || h.tier === "alias");
  if (!startsSomething) for (const [code, hit] of fuzzy) if (!best.has(code)) best.set(code, hit);

  return [...best.entries()]
    .map(([code, hit]) => ({ country: index.byCode.get(code)!, label: labelForKey(index, code, hit.key), ...hit }))
    .sort(
      (a, b) =>
        TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
        (a.tier === "alias" ? 0 : a.rank - b.rank) || // alias rank only picks each country's shortest alias
        compareText(a.label, b.label),
    )
    .slice(0, limit)
    .map(({ country, tier, key, label }) => {
      const suggestion: Suggestion = { country, tier, label };
      // Explain the match only when the displayed answer doesn't already show it.
      if (tier !== "fuzzy" && !normalize(label).includes(query)) suggestion.via = index.display.get(key) ?? key;
      return suggestion;
    });
}
