import { describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { toSovereignStates, type RawCountry } from "@/data/loadCountries";
import { initialsOf, pickHintTarget } from "./HintPanel";

const countries = toSovereignStates(snapshot as RawCountry[]);
const byCode = new Map(countries.map((c) => [c.code, c]));
const inRegion = (r: string) => countries.filter((c) => c.region === r);

describe("initialsOf", () => {
  it.each([
    ["Kenya", "K."],
    ["Burkina Faso", "B.F."],
    ["São Tomé and Príncipe", "S.T.P."],
    ["Guinea-Bissau", "G.B."],
    ["Saint Vincent and the Grenadines", "S.V.G."],
    ["DR Congo", "D.C."],
  ])("%s -> %s", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe("pickHintTarget", () => {
  const first = () => 0;

  it("stage 1 picks a country with land borders that gives away the fewest other answers", () => {
    const africa = inRegion("Africa");
    const scope = new Set(africa.map((c) => c.code));
    const target = pickHintTarget(africa, { scope, named: new Set(), needsBorders: true, random: first })!;
    expect(target.borders.length).toBeGreaterThan(0);
    const leaks = (code: string) => byCode.get(code)!.borders.filter((b) => scope.has(b)).length;
    const minimum = Math.min(...africa.filter((c) => c.borders.length).map((c) => leaks(c.code)));
    expect(leaks(target.code)).toBe(minimum);
  });

  it("already-named neighbours don't count as giveaways", () => {
    const europe = inRegion("Europe");
    const scope = new Set(europe.map((c) => c.code));
    // With all of Germany's neighbours named, Germany leaks nothing and wins.
    const named = new Set(byCode.get("DEU")!.borders);
    const missing = europe.filter((c) => !named.has(c.code));
    const target = pickHintTarget(missing, { scope, named, needsBorders: true, random: first })!;
    expect(target.borders.filter((b) => scope.has(b) && !named.has(b))).toEqual([]);
  });

  it("in Oceania, stage 1 uses the only bordered country, then falls back to islands", () => {
    const oceania = inRegion("Oceania");
    const scope = new Set(oceania.map((c) => c.code));
    expect(pickHintTarget(oceania, { scope, named: new Set(), needsBorders: true })!.code).toBe("PNG");
    const islands = oceania.filter((c) => c.code !== "PNG");
    const fallback = pickHintTarget(islands, { scope, named: new Set(["PNG"]), needsBorders: true })!;
    expect(fallback.borders).toEqual([]);
  });

  it("returns null when nothing is missing", () => {
    expect(pickHintTarget([], { scope: new Set(), named: new Set(), needsBorders: false })).toBeNull();
  });
});
