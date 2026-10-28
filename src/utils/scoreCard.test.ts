// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { mapForExport, renderScoreCard, scoreCardFileName } from "./scoreCard";

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
