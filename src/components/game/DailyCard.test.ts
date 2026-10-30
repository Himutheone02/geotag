import { describe, expect, it } from "vitest";
import { formatCountdown } from "./DailyCard";

describe("formatCountdown", () => {
  it.each([
    [(7 * 60 + 12) * 60_000, "7 h 12 min"],
    [(7 * 60 + 11) * 60_000 + 1, "7 h 12 min"], // rounds up: never claims less time than is left
    [3 * 3_600_000, "3 h"],
    [45 * 60_000, "45 min"],
    [20_000, "1 min"],
    [0, "1 min"],
  ])("%d ms -> %s", (ms, text) => {
    expect(formatCountdown(ms)).toBe(text);
  });
});
