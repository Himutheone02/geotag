import { describe, expect, it } from "vitest";
import type { RoundRecord } from "@/utils/db";
import {
  HINT_PENALTY_SECONDS,
  recallBand,
  recallStats,
  RECALL_BANDS,
  SPEEDRUN_MIN_COUNTRIES,
  SPEEDRUN_SECONDS,
  stampProgress,
} from "./ProfilePanel";

const round = (overrides: Partial<RoundRecord> = {}): RoundRecord => ({
  mode: "continent",
  roundKey: "Oceania",
  label: "Oceania",
  result: "won",
  timeMs: 70_000,
  guesses: 14,
  correct: 14,
  target: 14,
  hintsUsed: 0,
  moves: null,
  par: null,
  assisted: false,
  finishedAt: 1_000,
  ...overrides,
});

describe("recallStats", () => {
  it("averages each country's recall time across rounds, fastest first", () => {
    const stats = recallStats([
      round({ answers: [{ code: "FJI", ms: 2000, hinted: false, picked: false }, { code: "AUS", ms: 9000, hinted: false, picked: false }] }),
      round({ answers: [{ code: "FJI", ms: 4000, hinted: false, picked: false }] }),
    ]);
    expect(stats).toEqual([
      { code: "FJI", seconds: 3, answers: 2, hinted: 0 },
      { code: "AUS", seconds: 9, answers: 1, hinted: 0 },
    ]);
  });

  it("counts a hinted answer as at least the hint penalty, and skips picked answers", () => {
    const stats = recallStats([
      round({
        answers: [
          { code: "TUV", ms: 5000, hinted: true, picked: false },
          { code: "NRU", ms: 1000, hinted: false, picked: true },
        ],
      }),
    ]);
    expect(stats).toEqual([{ code: "TUV", seconds: HINT_PENALTY_SECONDS, answers: 1, hinted: 1 }]);
  });

  it("keeps countries and capitals apart, and ignores rounds without answer data", () => {
    const rounds = [
      round({ answers: [{ code: "FRA", ms: 1000, hinted: false, picked: false }] }),
      round({ answer: "capitals", answers: [{ code: "FRA", ms: 8000, hinted: false, picked: false }] }),
      round({}), // saved before answers were recorded
    ];
    expect(recallStats(rounds, "countries").map((s) => s.seconds)).toEqual([1]);
    expect(recallStats(rounds, "capitals").map((s) => s.seconds)).toEqual([8]);
  });

  it("bands times from green to red", () => {
    expect([2, 4, 4.1, 10, 15, 20, 21, 300].map(recallBand)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(RECALL_BANDS.map((b) => b.color)).toEqual(["#3cc96a", "#aa8f13", "#b45c03", "#a71f2d"]);
  });
});

describe("stampProgress", () => {
  const earned = (rounds: RoundRecord[]) =>
    Object.fromEntries(stampProgress(rounds).map(({ stamp, earnedAt }) => [stamp.id, earnedAt]));

  it("starts with nothing earned", () => {
    expect(earned([])).toEqual({ "roman-emperor": null, speedrunner: null, "world-traveler": null });
  });

  it("Roman Emperor: the Roman Empire won with no hints and no suggestions, in countries or capitals", () => {
    const roman = { mode: "historical" as const, roundKey: "Roman", label: "Roman Empire", target: 43 };
    expect(earned([round({ ...roman, hintsUsed: 1 })])["roman-emperor"]).toBeNull();
    expect(earned([round({ ...roman, assisted: true })])["roman-emperor"]).toBeNull();
    expect(earned([round({ ...roman, result: "forfeited" })])["roman-emperor"]).toBeNull();
    expect(earned([round({ ...roman, roundKey: "Ottoman" })])["roman-emperor"]).toBeNull();
    expect(earned([round({ ...roman, finishedAt: 5 })])["roman-emperor"]).toBe(5);
    expect(earned([round({ ...roman, roundKey: "Roman:capitals", finishedAt: 7 })])["roman-emperor"]).toBe(7);
  });

  it(`Speedrunner: a continent of more than ${SPEEDRUN_MIN_COUNTRIES} countries won at under ${SPEEDRUN_SECONDS} s per country, unassisted`, () => {
    const europe = { roundKey: "Europe", label: "Europe", target: 45 };
    expect(earned([round({ ...europe, timeMs: 45 * 3000 })]).speedrunner).toBeNull(); // exactly 3 s isn't under
    expect(earned([round({ ...europe, timeMs: 45 * 2900, finishedAt: 9 })]).speedrunner).toBe(9);
    expect(earned([round({ ...europe, timeMs: 45 * 2900, assisted: true })]).speedrunner).toBeNull();
    expect(earned([round({ ...europe, timeMs: 1000, result: "forfeited" })]).speedrunner).toBeNull();
    // Every continent but Oceania qualifies; Oceania never does, however fast.
    for (const [roundKey, target] of [["Africa", 54], ["Americas", 35], ["Asia", 47]] as const) {
      expect(earned([round({ roundKey, label: roundKey, target, timeMs: target * 2000 })]).speedrunner).not.toBeNull();
    }
    expect(earned([round({ roundKey: "Oceania", target: 14, timeMs: 14 * 1000 })]).speedrunner).toBeNull();
    expect(earned([round({ mode: "historical", roundKey: "British", target: 66, timeMs: 66 * 1000 })]).speedrunner).toBeNull();
  });

  it("World Traveler: any World round, finished or not", () => {
    expect(earned([round({ mode: "world", roundKey: "World", result: "forfeited", finishedAt: 3 })])["world-traveler"]).toBe(3);
  });

  it("dates each stamp from the first round that earned it", () => {
    const world = { mode: "world" as const, roundKey: "World" };
    expect(earned([round({ ...world, finishedAt: 50 }), round({ ...world, finishedAt: 20 })])["world-traveler"]).toBe(20);
  });
});
