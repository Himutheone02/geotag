import CountryGuesser from "./CountryGuesser";
import { getSovereignStates, resolveEmpires } from "@/data/loadCountries";

// Fully static: the page is built once from the bundled countries.json. Nothing is
// fetched, at build time or in the browser.

export default function Home() {
  const countries = getSovereignStates();
  const empires = resolveEmpires(countries);

  return (
    <main className="game">
      <CountryGuesser countries={countries} empires={empires} />
    </main>
  );
}
