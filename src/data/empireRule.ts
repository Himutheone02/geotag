/**
 * The inclusion rule every empire list follows (historical_empires.json), shown on the
 * Empires setup screen. Kept apart from loadCountries.ts so the client bundle can show it
 * without pulling in the country data.
 *
 * A country is listed if any part of its present territory was directly governed by the
 * empire at some point in the era on its tile: annexed, or run by the empire's own officials.
 * Vassal states, protected states that kept their own rulers and government, and wartime
 * occupations don't count. Where only part of a country qualified,
 * historical_empire_notes.json says which part.
 */
export const EMPIRE_RULE = {
  short: "Any part of today's country was directly governed by the empire during its era.",
  detail: "Annexed or run by its own officials counts. Vassals, protected states with their own rulers, and wartime occupations don't.",
} as const;
