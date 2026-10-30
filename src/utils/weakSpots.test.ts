import { describe, expect, it } from "vitest";
import type { AnswerRecord, RoundRecord } from "./db";
import { ASSISTED_SECONDS, MISS_SECONDS, pickWeakSpots, recallWithMisses, WEAK_SPOTS_SIZE } from "./weakSpots";
import { HINT_PENALTY_SECONDS } from "@/components/game/ProfilePanel";

const answer = (code: string, seconds: number, extra: Partial<AnswerRecord> = {}): AnswerRecord => ({
  code,
  ms: seconds * 1000,
  hinted: false,
  picked: false,
  ...extra,
});
const round = (overrides: Partial<RoundRecord>): RoundRecord => ({
  mode: "continent",
  roundKey: "Test",
  label: "Test",
  result: "won",
  timeMs: 0,
  guesses: 0,
  correct: 0,
  target: 0,
  hintsUsed: 0,
  moves: null,
  par: null,
  assisted: false,
  finishedAt: 0,
  ...overrides,
});
const noTargets = () => undefined;

describe("recallWithMisses", () => {
  it("averages each country's answers, slowest first", () => {
    const recall = recallWithMisses(
      [round({ answers: [answer("FRA", 2), answer("DEU", 12)] }), round({ answers: [answer("FRA", 4)] })],
      noTargets,
    );
    expect(recall.map((r) => [r.code, r.seconds, r.answers])).toEqual([
      ["DEU", 12, 1],
      ["FRA", 3, 2],
    ]);
  });

  it("counts a country a given-up round asked for but never got as a miss", () => {
    const given = round({ result: "forfeited", targets: ["FRA", "DEU", "ITA"], answers: [answer("FRA", 2)] });
    const recall = recallWithMisses([given], noTargets);
    expect(recall.map((r) => [r.code, r.seconds, r.misses])).toEqual([
      ["DEU", MISS_SECONDS, 1],
      ["ITA", MISS_SECONDS, 1],
      ["FRA", 2, 0],
    ]);
  });

  it("finds an older round's countries from its key, when the record doesn't list them", () => {
    const older = round({ result: "forfeited", roundKey: "Oceania", answers: [] });
    const recall = recallWithMisses([older], (key) => (key === "Oceania" ? ["FJI", "TON"] : undefined));
    expect(recall.map((r) => r.code)).toEqual(["FJI", "TON"]);
  });

  it("treats hinted and picked answers as at least the assisted floor (the heatmap's hint floor)", () => {
    expect(ASSISTED_SECONDS).toBe(HINT_PENALTY_SECONDS);
    const recall = recallWithMisses(
      [round({ answers: [answer("FRA", 1, { hinted: true }), answer("DEU", 1, { picked: true }), answer("ITA", 45, { picked: true })] })],
      noTargets,
    );
    expect(Object.fromEntries(recall.map((r) => [r.code, r.seconds]))).toEqual({ FRA: ASSISTED_SECONDS, DEU: ASSISTED_SECONDS, ITA: 45 });
  });

  it("only uses country-name rounds: not capitals, flags, routes, or rounds saved without answers", () => {
    const recall = recallWithMisses(
      [
        round({ answer: "capitals", answers: [answer("FRA", 50)] }),
        round({ mode: "flags", answers: [answer("DEU", 50)] }),
        round({ mode: "pathfinding", answers: [answer("ITA", 50)] }),
        round({ result: "forfeited", targets: ["ESP"] }),
        round({ mode: "practice", answers: [answer("PRT", 7)] }),
      ],
      noTargets,
    );
    expect(recall.map((r) => r.code)).toEqual(["PRT"]);
  });
});

describe("pickWeakSpots", () => {
  const all = Array.from({ length: 30 }, (_, i) => `C${String(i).padStart(2, "0")}`);
  const first = () => 0;

  it("takes the 10 weakest when there are enough", () => {
    const recall = all.slice(0, 15).map((code, i) => ({ code, seconds: 30 - i, answers: 1, misses: 0 }));
    const spots = pickWeakSpots(recall, all, first);
    expect(spots).toEqual({ codes: all.slice(0, 10), fromProfile: 10 });
  });

  it("pads with random countries the player hasn't been asked for, without repeats", () => {
    const recall = [
      { code: "C05", seconds: 20, answers: 1, misses: 0 },
      { code: "C07", seconds: 60, answers: 0, misses: 1 },
    ];
    const spots = pickWeakSpots(recall, all, Math.random);
    expect(spots.fromProfile).toBe(2);
    expect(spots.codes).toHaveLength(WEAK_SPOTS_SIZE);
    expect(spots.codes.slice(0, 2)).toEqual(["C05", "C07"]);
    expect(new Set(spots.codes).size).toBe(WEAK_SPOTS_SIZE);
    for (const code of spots.codes.slice(2)) expect(["C05", "C07"]).not.toContain(code);
  });

  it("is all random for a new player", () => {
    const spots = pickWeakSpots([], all, Math.random);
    expect(spots.fromProfile).toBe(0);
    expect(new Set(spots.codes).size).toBe(WEAK_SPOTS_SIZE);
    for (const code of spots.codes) expect(all).toContain(code);
  });

  it("ignores evidence about countries outside the game", () => {
    const spots = pickWeakSpots([{ code: "XKX", seconds: 99, answers: 1, misses: 0 }], all, first);
    expect(spots.codes).not.toContain("XKX");
    expect(spots.fromProfile).toBe(0);
  });
});
