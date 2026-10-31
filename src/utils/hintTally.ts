/**
 * The Guessing hints: tallies over every answer still missing, recomputed from the missing
 * list on each render, so they shrink as the player names countries.
 *
 *   Starting Letters  "M (3), C (1), T (1)"               most common first, ties A to Z
 *   Name Lengths      "4 letters (1), 8 letters (2)"      shortest first
 *
 * They count the names this game shows ("Ivory Coast", "DR Congo"), and in Capitals rounds
 * each country's displayed capital. Accents fold into their letter (Türkiye counts under T),
 * and only letters count toward a length: "Guinea-Bissau" has 12, "Sri Lanka" has 8.
 */

/** One bucket of a tally: what it's about, how many answers, and how it reads. */
export type TallyItem = { key: string; count: number; text: string };

const LETTER = /\p{L}/u;

/** How many letters a name has (spaces, hyphens and apostrophes don't count). */
export function letterCount(name: string): number {
  return [...name].filter((ch) => LETTER.test(ch)).length;
}

/** The first letter, accent folded and capitalized: "Türkiye" -> "T", "São Tomé" -> "S". */
export function startingLetter(name: string): string {
  const first = [...name].find((ch) => LETTER.test(ch)) ?? "";
  return first.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
}

function countBy(names: readonly string[], keyOf: (name: string) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) {
    const key = keyOf(name);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** First letters of the names, most common first; equal counts in alphabetical order. */
export function startingLetters(names: readonly string[]): TallyItem[] {
  return [...countBy(names, startingLetter)]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .map(([letter, count]) => ({ key: letter, count, text: `${letter} (${count})` }));
}

/** Letter counts of the names, shortest first. */
export function nameLengths(names: readonly string[]): TallyItem[] {
  return [...countBy(names, (name) => String(letterCount(name)))]
    .map(([length, count]) => [Number(length), count] as const)
    .sort(([a], [b]) => a - b)
    .map(([length, count]) => ({ key: String(length), count, text: `${length} letter${length === 1 ? "" : "s"} (${count})` }));
}

/** The readout as one line: "M (3), C (1), T (1)". */
export function tallyText(items: readonly TallyItem[]): string {
  return items.map((i) => i.text).join(", ");
}
