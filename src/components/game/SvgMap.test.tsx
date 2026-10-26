// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import snapshot from "@/data/countries.json";
import { resolveEmpires, toSovereignStates, type RawCountry } from "@/data/loadCountries";
import { CONTINENTS, type RoundKey } from "@/app/CountryGuesser";
import SvgMap, { buildMapGeometry } from "./SvgMap";
import { buildBorderGraph, pickRoute } from "@/utils/pathfinding";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const countries = toSovereignStates(snapshot as RawCountry[]);
const codesIn = (region: string) => countries.filter((c) => c.region === region).map((c) => c.code);
const regions = Object.fromEntries(countries.map((c) => [c.code, c.region]));
const ROUNDS: [RoundKey, string[]][] = [
  ...CONTINENTS.map((c) => [c, codesIn(c)] as [RoundKey, string[]]),
  ...resolveEmpires(countries).map((e) => [e.key, e.codes] as [RoundKey, string[]]),
  ["World", countries.map((c) => c.code)],
];

describe("buildMapGeometry", () => {
  it.each(ROUNDS)("every country in the %s round is visible on its map", (round, codes) => {
    const geometry = buildMapGeometry(round, codes);
    const [vx, vy, vw, vh] = geometry.viewBox;
    const inView = ([x, y]: [number, number]) => x >= vx && x <= vx + vw && y >= vy && y <= vy + vh;
    const invisible: string[] = [];
    for (const t of geometry.targets.values()) {
      if (t.marker) {
        if (!inView(t.marker)) invisible.push(`${t.code} (marker off-map)`);
      } else if (!t.bounds) {
        invisible.push(`${t.code} (no outline, no marker)`);
      } else {
        const [[x0, y0], [x1, y1]] = t.bounds;
        if (x1 < vx || x0 > vx + vw || y1 < vy || y0 > vy + vh) invisible.push(`${t.code} (outline off-map)`);
      }
    }
    expect(invisible).toEqual([]);
  });

  it("gives tiny or missing countries a dot marker, but not large ones", () => {
    const europe = buildMapGeometry("Europe", codesIn("Europe"));
    for (const code of ["VAT", "MCO", "SMR", "LIE", "AND", "MLT"]) expect(europe.targets.get(code)!.marker).not.toBeNull();
    for (const code of ["FRA", "DEU", "RUS"]) expect(europe.targets.get(code)!.marker).toBeNull();
    const oceania = buildMapGeometry("Oceania", codesIn("Oceania"));
    expect(oceania.targets.get("TUV")!.d).toBeNull(); // not in Natural Earth 1:50m at all
    expect(oceania.targets.get("TUV")!.marker).not.toBeNull();
    expect(oceania.targets.get("AUS")!.marker).toBeNull();
  });

  it("shrinks the threshold and dots at world zoom so small European countries show as shapes", () => {
    const world = buildMapGeometry("World", countries.map((c) => c.code));
    const dots = [...world.targets.values()].filter((t) => t.marker).length;
    expect(dots).toBeLessThanOrEqual(45);
    for (const code of ["NLD", "BEL", "CHE"]) expect(world.targets.get(code)!.marker).toBeNull();
    for (const code of ["VAT", "SGP", "TUV"]) expect(world.targets.get(code)!.marker).not.toBeNull();
    expect(world.markerRadius).toBeLessThan(buildMapGeometry("Europe", codesIn("Europe")).markerRadius);
  });

  it("keeps Oceania in one piece across the 180° meridian", () => {
    const g = buildMapGeometry("Oceania", codesIn("Oceania"));
    const x = (code: string) => g.targets.get(code)!.marker?.[0] ?? g.targets.get(code)!.origin[0];
    // Samoa and Tonga (west of 180°) sit east of Australia, not wrapped to the far left
    expect(x("WSM")).toBeGreaterThan(x("AUS"));
    expect(x("TON")).toBeGreaterThan(x("NZL"));
  });
});

describe("SvgMap", () => {
  let container: HTMLDivElement;
  let root: Root;
  const targets = codesIn("Europe");
  const render = (named: string[], highlight: string | null = null) =>
    act(() =>
      root.render(
        <SvgMap
          frame="Europe"
          label="Europe"
          theme="Europe"
          regions={regions}
          targets={targets}
          named={new Set(named)}
          highlight={highlight}
        />,
      ),
    );

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("draws the round's countries as blank targets and the rest as context", () => {
    render([]);
    expect(container.querySelectorAll(".map-country--target").length).toBeGreaterThanOrEqual(40);
    expect(container.querySelector('.map-country[data-code="EGY"]')!.classList.contains("map-country--target")).toBe(false);
    expect(container.querySelector("svg")!.getAttribute("aria-label")).toBe("Map of Europe: 0 of 45 countries named");
  });

  it("fills named countries on a raised layer, and named microstates as filled dots", () => {
    render(["FRA", "VAT"]);
    // Vatican City has a sub-pixel outline as well as its dot; both fill in.
    expect([...container.querySelectorAll(".map-named")].map((p) => p.getAttribute("data-code"))).toEqual(["FRA", "VAT"]);
    expect(container.querySelector('.map-marker--named[data-code="VAT"]')).not.toBeNull();
    expect(container.querySelector("svg")!.getAttribute("data-theme")).toBe("Europe");
    // Themed rounds color by theme, not per country
    expect(container.querySelector('.map-named[data-code="FRA"]')!.hasAttribute("data-region")).toBe(false);
  });

  it("pulses the hinted country until it is named", () => {
    render([], "POL");
    expect(container.querySelector(".map-hint")!.getAttribute("data-code")).toBe("POL");
    expect(container.querySelector(".map-hint-shape")).not.toBeNull();
    render(["POL"], "POL");
    expect(container.querySelector(".map-hint")).toBeNull();
  });

  it("pulses a ring around a hinted microstate", () => {
    render([], "SMR");
    expect(container.querySelector(".map-hint-ring")).not.toBeNull();
  });
});

describe("empire framing", () => {
  const empires = resolveEmpires(countries);
  const frameOf = (key: RoundKey) => {
    const codes = key === "World" ? countries.map((c) => c.code) : empires.find((e) => e.key === key)!.codes;
    return buildMapGeometry(key, codes);
  };

  it("zooms each empire to its own region, with the British Empire and World Mode shown whole", () => {
    const width = (key: RoundKey) => frameOf(key).viewBox[2];
    const height = (key: RoundKey) => frameOf(key).viewBox[3];
    // Same rendering width, so a smaller height means a wider (zoomed-out) frame.
    expect(height("British")).toBeLessThan(height("Roman"));
    expect(height("British")).toBeCloseTo(height("World"), 6);
    expect(width("Mughal")).toBeCloseTo(width("Roman"), 6);
  });

  it("frames the Roman Empire on the Mediterranean, not the whole world", () => {
    const roman = frameOf("Roman");
    const [vx, , vw] = roman.viewBox;
    const x = (code: string) => roman.targets.get(code)!.origin[0];
    // Portugal near the left edge, Iraq near the right: the frame hugs the empire.
    expect(x("PRT")).toBeLessThan(vx + vw * 0.25);
    expect(x("IRQ")).toBeGreaterThan(vx + vw * 0.75);
  });
});

describe("route framing", () => {
  const graph = buildBorderGraph(countries);
  let seed = 5;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

  it("frames 60 random routes with the start, the end and a shortest route on screen", { timeout: 30_000 }, () => {
    const problems: string[] = [];
    for (let i = 0; i < 60; i++) {
      const puzzle = pickRoute(graph, { random })!;
      const g = buildMapGeometry({ around: puzzle.shortest }, puzzle.shortest);
      const [vx, vy, vw, vh] = g.viewBox;
      for (const code of puzzle.shortest) {
        const t = g.targets.get(code)!;
        const box = t.marker ? [[t.marker[0], t.marker[1]], [t.marker[0], t.marker[1]]] : t.bounds!;
        const [[x0, y0], [x1, y1]] = box;
        if (x1 < vx || x0 > vx + vw || y1 < vy || y0 > vy + vh) problems.push(`${puzzle.start}->${puzzle.end}: ${code} off-map`);
      }
      // Endpoints must be fully framed, not just clipped in
      for (const code of [puzzle.start, puzzle.end]) {
        const [x, y] = g.targets.get(code)!.marker ?? g.targets.get(code)!.origin;
        if (x <= vx || x >= vx + vw || y <= vy || y >= vy + vh) problems.push(`${code} endpoint at the edge`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("frames Portugal to China across Eurasia without a thin strip", () => {
    const shortest = ["PRT", "ESP", "FRA", "DEU", "POL", "RUS", "CHN"];
    const [, , w, h] = buildMapGeometry({ around: shortest }, shortest).viewBox;
    expect(h / w).toBeGreaterThan(0.3);
  });
});
