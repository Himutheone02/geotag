import CountryGuesser from "./CountryGuesser";
import { getDailySource, getSovereignStates, resolveEmpires } from "@/data/loadCountries";

// Rebuild the page (and refetch REST Countries) at most once a day.
export const revalidate = 86400;

export default async function Home() {
  const { countries, source } = await getSovereignStates();
  const empires = resolveEmpires(countries);
  // The Daily Challenge always comes from the bundled snapshot, whatever source the live list came from.
  const dailySource = getDailySource();

  return (
    <main className="game">
      <CountryGuesser countries={countries} empires={empires} source={source} dailySource={dailySource} />
    </main>
  );
}
