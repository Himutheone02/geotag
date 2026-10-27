import { existsSync } from "node:fs";
import path from "node:path";
import CountryGuesser from "./CountryGuesser";
import type { BrandAssets } from "@/components/game/SplashScreen";
import { getDailySource, getSovereignStates, resolveEmpires } from "@/data/loadCountries";

// Rebuild the page (and refetch REST Countries) at most once a day.
export const revalidate = 86400;

/** The first of these files that exists in /public, as a URL path, or null. */
function firstPublicFile(candidates: string[]): string | null {
  const found = candidates.find((file) => existsSync(path.join(process.cwd(), "public", file)));
  return found ? `/${found}` : null;
}

/**
 * Which splash files are in /public. Checked on the server, so the splash never
 * requests one that isn't there; without them it plays its CSS intro and lands on a
 * clay globe and the wordmark. (The header logo, /logo.png, isn't checked: it's always used.)
 */
function findBrandAssets(): BrandAssets {
  return {
    splashLogo: firstPublicFile(["assets/logo-full.webp", "assets/logo-full.png"]),
    introVideo: firstPublicFile(["assets/boot-up.mp4"]),
    introGif: firstPublicFile(["assets/boot-up.gif"]),
  };
}

export default async function Home() {
  const { countries, source } = await getSovereignStates();
  const empires = resolveEmpires(countries);
  // The Daily Challenge always comes from the bundled snapshot, whatever source the live list came from.
  const dailySource = getDailySource();

  return (
    <main className="game">
      <CountryGuesser
        countries={countries}
        empires={empires}
        source={source}
        dailySource={dailySource}
        brand={findBrandAssets()}
      />
    </main>
  );
}
