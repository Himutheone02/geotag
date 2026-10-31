import { describe, expect, it } from "vitest";
import { letterCount, nameLengths, startingLetter, startingLetters, tallyText } from "./hintTally";

describe("startingLetter", () => {
  it("is the first letter, capitalized, with accents folded", () => {
    expect(startingLetter("Mali")).toBe("M");
    expect(startingLetter("Türkiye")).toBe("T");
    expect(startingLetter("São Tomé and Príncipe")).toBe("S");
    expect(startingLetter("Éire")).toBe("E");
    expect(startingLetter("  ivory Coast")).toBe("I");
  });
});

describe("letterCount", () => {
  it("counts letters only", () => {
    expect(letterCount("Chad")).toBe(4);
    expect(letterCount("Guinea-Bissau")).toBe(12);
    expect(letterCount("Sri Lanka")).toBe(8);
    expect(letterCount("Saint Vincent and the Grenadines")).toBe(28);
  });
});

describe("startingLetters", () => {
  it("counts first letters, most common first, ties A to Z", () => {
    const tally = startingLetters(["Malta", "Togo", "Mali", "Chad", "Mongolia"]);
    expect(tally.map((t) => [t.key, t.count])).toEqual([
      ["M", 3],
      ["C", 1],
      ["T", 1],
    ]);
    expect(tallyText(tally)).toBe("M (3), C (1), T (1)");
  });

  it("is empty for nothing left", () => {
    expect(startingLetters([])).toEqual([]);
    expect(tallyText(startingLetters([]))).toBe("");
  });
});

describe("nameLengths", () => {
  it("counts letters per name, shortest first", () => {
    const tally = nameLengths(["Cameroon", "Chad", "Botswana"]);
    expect(tally.map((t) => [t.key, t.count])).toEqual([
      ["4", 1],
      ["8", 2],
    ]);
    expect(tallyText(tally)).toBe("4 letters (1), 8 letters (2)");
  });

  it("sorts by number, not text: 4 before 10", () => {
    expect(nameLengths(["Madagascar", "Laos"]).map((t) => t.key)).toEqual(["4", "10"]);
  });

  it("doesn't count spaces or hyphens", () => {
    expect(tallyText(nameLengths(["Timor-Leste", "Sri Lanka"]))).toBe("8 letters (1), 10 letters (1)");
  });
});
