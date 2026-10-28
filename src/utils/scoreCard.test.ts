// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { HEAT_MAX_SECONDS, HEAT_STOPS, heatColor, mapForExport, renderScoreCard, scoreCardFileName } from "./scoreCard";

const NS = "http://www.w3.org/2000/svg";
function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function sampleMap() {
  const svg = el("svg", { viewBox: "0 0 400 300", class: "world-map" });
  const land = el("path", { d: "M0 0L10 10", style: "fill: rgb(1, 2, 3)", class: "map-country" });
  const label = el("text", { x: "100", y: "50", class: "map-label" });
  label.textContent = "France";
  const hits = el("g", { class: "map-hits" });
  hits.append(el("circle", { r: "9" }));
  const selected = el("g", { class: "map-selected" });
  const titled = el("path", { d: "M1 1" });
  titled.append(el("title"));
  svg.append(land, label, hits, selected, titled);
  document.body.append(svg);
  return svg;
}

describe("scoreCardFileName", () => {
  it("makes a plain file name from the route", () => {
    expect(scoreCardFileName("France to China")).toBe("geotag-france-to-china.png");
    expect(scoreCardFileName("Côte d'Ivoire to São Tomé and Príncipe")).toBe("geotag-cote-d-ivoire-to-sao-tome-and-principe.png");
    expect(scoreCardFileName("")).toBe("geotag-route.png");
  });
});

describe("mapForExport", () => {
  it("copies the map at the card's size, with its styles written in and the labels and tap layers left out", () => {
    const svg = sampleMap();
    const markup = mapForExport(svg, 800, 800);
    expect(markup).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(markup).toContain('width="800"');
    expect(markup).toContain('height="800"');
    expect(markup).toContain('viewBox="0 0 400 300"');
    expect(markup).toContain("fill:rgb(1, 2, 3)");
    for (const gone of ["<text", "map-hits", "map-selected", "<title", 'class="world-map"']) expect(markup).not.toContain(gone);
    // The live map is untouched.
    expect(svg.querySelector("text")!.textContent).toBe("France");
    expect(svg.getAttribute("width")).toBeNull();
    svg.remove();
  });
});

describe("renderScoreCard", () => {
  it("resolves to null where the browser can't draw on a canvas", async () => {
    const svg = sampleMap();
    expect(await renderScoreCard({ map: svg, logo: null, title: "France to China", time: "01:23", details: "5 moves" })).toBeNull();
    svg.remove();
  });
});

describe("heatColor (the card's step heatmap)", () => {
  const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const near = (a: string, b: string) => rgb(a).every((v, i) => Math.abs(v - rgb(b)[i]) <= 1);

  it("runs from cool (fast) through the middle stop to hot (slow), clamped at both ends", () => {
    expect(near(heatColor(0), HEAT_STOPS[0])).toBe(true);
    expect(near(heatColor(HEAT_MAX_SECONDS / 2), HEAT_STOPS[1])).toBe(true);
    expect(near(heatColor(HEAT_MAX_SECONDS), HEAT_STOPS[2])).toBe(true);
    expect(heatColor(-4)).toBe(heatColor(0));
    expect(heatColor(90)).toBe(heatColor(HEAT_MAX_SECONDS));
    expect(HEAT_MAX_SECONDS).toBe(15);
  });

  it("gets steadily hotter: more red, less blue, second by second", () => {
    const colors = Array.from({ length: HEAT_MAX_SECONDS + 1 }, (_, s) => rgb(heatColor(s)));
    for (let s = 1; s < colors.length; s++) {
      expect(colors[s][0] - colors[s][2]).toBeGreaterThan(colors[s - 1][0] - colors[s - 1][2]);
    }
  });
});

describe("mapForExport recolor (heatmap)", () => {
  it("repaints the route's named countries and dots, and nothing else", () => {
    const svg = el("svg", { viewBox: "0 0 10 10" });
    const land = el("path", { d: "M0 0", "data-code": "FRA", class: "map-country", style: "fill: rgb(9, 9, 9)" });
    const named = el("path", { d: "M0 0", "data-code": "FRA", class: "map-named", style: "fill: rgb(1, 1, 1)" });
    const dot = el("circle", { r: "1", "data-code": "AND", class: "map-marker map-marker--named" });
    const end = el("path", { d: "M0 0", "data-code": "DEU", class: "map-named", style: "fill: rgb(2, 2, 2)" });
    svg.append(land, named, dot, end);
    document.body.append(svg);
    const markup = mapForExport(svg, 100, 100, { FRA: "#3fbfd8", AND: "#d7263d" });
    const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
    const styleOf = (sel: string) => doc.querySelector(sel)!.getAttribute("style") ?? "";
    expect(styleOf(".map-country")).not.toContain("#3fbfd8"); // the base land stays as it is
    expect(styleOf('.map-named[data-code="FRA"]')).toMatch(/fill:#3fbfd8$/);
    expect(styleOf(".map-marker--named")).toMatch(/fill:#d7263d$/);
    expect(styleOf('.map-named[data-code="DEU"]')).not.toMatch(/#/); // not a step: untouched
    svg.remove();
  });
});
