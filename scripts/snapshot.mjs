// Refreshes src/data/countries.json from the live REST Countries API.
// The snapshot is the app's fallback when the API is down. Run: npm run snapshot
import { writeFile } from "node:fs/promises";

// 10 fields: the API maximum. ccn3 and latlng are only used by scripts/build-map.mjs.
const FIELDS = ["name", "cca3", "ccn3", "altSpellings", "region", "subregion", "unMember", "capital", "borders", "latlng"];
const URL = `https://restcountries.com/v3.1/all?fields=${FIELDS.join(",")}`;
const OUT = new globalThis.URL("../src/data/countries.json", import.meta.url);

const res = await fetch(URL, { signal: AbortSignal.timeout(15000) });
if (!res.ok) {
  console.error(`REST Countries responded ${res.status}`);
  process.exit(1);
}
const data = await res.json();
if (!Array.isArray(data) || data.length < 190) {
  console.error("Unexpected response; snapshot not written.");
  process.exit(1);
}

const trimmed = data
  .map((c) => ({
    name: { common: c.name.common, official: c.name.official },
    cca3: c.cca3,
    ccn3: c.ccn3 ?? null,
    altSpellings: c.altSpellings ?? [],
    region: c.region ?? "",
    subregion: c.subregion ?? "",
    unMember: c.unMember === true,
    capital: c.capital ?? [],
    borders: c.borders ?? [],
    latlng: c.latlng ?? null,
  }))
  .sort((a, b) => a.cca3.localeCompare(b.cca3));

await writeFile(OUT, JSON.stringify(trimmed, null, 1) + "\n");
const sovereign = trimmed.filter((c) => c.unMember || c.cca3 === "VAT" || c.cca3 === "PSE").length;
console.log(`Wrote ${trimmed.length} entries (${sovereign} sovereign by app rule) to ${OUT.pathname}`);
