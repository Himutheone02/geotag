// Builds src/data/world-map.json from Natural Earth 1:50m (world-atlas) and src/data/countries.json.
//   - re-keys every shape from ISO numeric ids to cca3 codes (one shape per country)
//   - simplifies the outlines to keep the file small
//   - adds a [lon, lat] marker point for every sovereign state, so countries
//     too small to see at continent zoom (or absent from the data: Tuvalu)
//     can still be shown, named and hinted.
// Run: npm run build:map   (optional args: fraction of points to keep [default 0.15], output path)
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { quantize } from "topojson-client";
import { presimplify, quantile, simplify } from "topojson-simplify";

const require = createRequire(import.meta.url);
const SOURCE = require.resolve("world-atlas/countries-50m.json");
const COUNTRIES = new URL("../src/data/countries.json", import.meta.url);
const OUT = process.argv[3] ? pathToFileURL(resolve(process.argv[3])) : new URL("../src/data/world-map.json", import.meta.url);
// Fraction of outline points to keep (least visually important points are dropped first).
const Q = Number(process.argv[2] ?? 0.15);

const countries = JSON.parse(await readFile(COUNTRIES, "utf8"));
const byCcn3 = new Map(countries.filter((c) => c.ccn3).map((c) => [c.ccn3, c.cca3]));
const isSovereign = (c) => c.unMember === true || c.cca3 === "VAT" || c.cca3 === "PSE";

let topology = JSON.parse(await readFile(SOURCE, "utf8"));
const unmatched = [];
for (const g of topology.objects.countries.geometries) {
  const cca3 = g.id ? byCcn3.get(g.id) : undefined;
  if (!cca3) unmatched.push(g.properties?.name ?? g.id);
  g.id = cca3 ?? null; // unmatched shapes (Kosovo, N. Cyprus, Somaliland...) stay as unlabeled land
  delete g.properties;
}
delete topology.objects.land;

// Some shapes share a code (Ashmore and Cartier Is. carry Australia's 036):
// merge them into one MultiPolygon so each country is exactly one shape.
const merged = new Map();
const geometries = [];
for (const g of topology.objects.countries.geometries) {
  const parts = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
  const existing = g.id ? merged.get(g.id) : undefined;
  if (existing) {
    existing.arcs.push(...parts);
  } else {
    const shape = { type: "MultiPolygon", id: g.id, arcs: parts };
    if (g.id) merged.set(g.id, shape);
    geometries.push(shape);
  }
}
topology.objects.countries.geometries = geometries;

topology = presimplify(topology);
topology = simplify(topology, quantile(topology, Q));
topology = quantize(topology, 1e4); // back to small delta-encoded integers

const points = {};
for (const c of countries) {
  if (isSovereign(c) && c.latlng) points[c.cca3] = [+c.latlng[1].toFixed(2), +c.latlng[0].toFixed(2)];
}

const json = JSON.stringify({ topology, points });
await writeFile(OUT, json);
console.log(`q=${Q}: ${(json.length / 1024).toFixed(0)} KB, ${topology.objects.countries.geometries.length} shapes, ${Object.keys(points).length} marker points`);
console.log(`unlabeled shapes: ${unmatched.join(", ")}`);
