# geotag

Next.js (App Router, TypeScript) geography game. Pick a round (a continent, a historical empire, or the whole world), then name every sovereign state in it against a running clock. Or play Pathfinding: cross from one country to another by naming land neighbours. Answers are recognized as you type, typos and alternate names included. Named countries fill in on a clay map, and three progressive hints help when you're stuck. An optional autocomplete list suggests answers, and every finished round is saved to a local profile (IndexedDB) with stats on the setup screen's **Profile & Stats** tab. List rounds can be played for **capitals** instead of countries, a seeded **Daily Challenge** gives everyone the same puzzle each day, and results can be shared as a spoiler-free emoji grid.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # matcher, timer and game-flow tests, run against the real country data
npm run snapshot   # refresh the offline fallback from the live REST Countries API
npm run build:map  # rebuild src/data/world-map.json (run after a snapshot refresh)
```

## How it fits together

| File | Role |
| --- | --- |
| `src/app/page.tsx` | Server Component: loads the countries and renders the game. |
| `src/app/CountryGuesser.tsx` | Interactive client component: rounds (continent, empire, world), game session reducer (`sessionReducer`), setup with the mode switch, live typing, results. Must be its own file because `"use client"` applies to a whole file. |
| `src/app/globals.css` | The whole claymorphic theme: every design token (color, shadows, radii, springs, type, space) in `:root`, plus component and game styles. |
| `src/components/ui/ClayCard.tsx` | Extruded container (`as` picks the element). |
| `src/components/ui/ClayInput.tsx` | Clay text field with an always-present label (`hideLabel` hides it visually only). Forwards `ref` (React 19). Given `suggestions`, it becomes an ARIA combobox with a floating `ClayCard` list (arrows, Enter, Escape, click). |
| `src/components/ui/ClayButton.tsx` | Clay button, `primary` or `soft`, `md` or `sm`; lifts on hover, sinks when pressed. |
| `src/components/game/Timer.tsx` | Isolated count-up stopwatch (MM:SS). Owns its own state, so ticks never re-render the game. |
| `src/components/game/SvgMap.tsx` | Inline SVG map (d3-geo projection, no canvas/WebGL). Frames each continent, fills named countries, pulses the stage-2 hint, and takes a static color per country (`fills`) for the heatmap. Memoized and lazy-loaded. |
| `src/components/game/HintPanel.tsx` | "Get a hint (n/3)" button and revealed hints, plus the pure helpers `pickHintTarget` and `initialsOf`. |
| `src/components/game/DailyCard.tsx` | The setup screen's Daily Challenge card: today's puzzle, and once played, the first result with its Share button. |
| `src/components/game/ShareResult.tsx` | Copy-to-clipboard button with `navigator.clipboard.writeText` ("Share result", "Create NFC Challenge"); if the clipboard is unavailable the text stays visible to copy by hand. |
| `src/components/game/ProfilePanel.tsx` | The Profile & Stats tab: passport stamps, stat tiles, average winning time per mode (clay bar chart), the recall heatmap (reusing `SvgMap`), personal bests, recent rounds, clear history. Pure helpers `recallStats`, `recallBand`, `stampProgress`, `personalBests`. |
| `public/fonts/` | Fredoka variable font (Latin subset, 68 KB) and its OFL license. Self-hosted, no runtime Google Fonts call. |
| `src/utils/fuzzyMatch.ts` | Matching: `normalize`, `buildIndex` (country names, or capitals with `"capitals"`), `matchCountry`, `liveMatch` (per-keystroke rules), `suggestCountries` (autocomplete ranking), `answerForInput`, and the `Country` type. |
| `src/utils/dailySeed.ts` | Mulberry32 PRNG, FNV-1a hash of the date, `dateKey` (local YYYY-MM-DD) and `dailyChallenge` (seeded route or continent). |
| `src/utils/share.ts` | Spoiler-free share text: `routeGrid`, `paceGrid`, `buildShareText`. |
| `src/utils/db.ts` | Local profile in raw IndexedDB (database `country-recall`, stores `rounds` and `settings`): `saveRound`, `listRounds`, `clearRounds`, `getSetting`/`setSetting`, and the pure `summarize`. Every call fails soft when storage is unavailable. |
| `src/utils/pathfinding.ts` | Land-border graph (`buildBorderGraph`), breadth-first search (`bfsDistances`, `shortestPath`), route puzzles (`pickRoute`) and step rules (`applyStep`, `reachesEnd`). |
| `src/data/countries.json` | Country data: offline copy of the REST Countries fields the app uses (10 fields, the API maximum). |
| `src/data/world-map.json` | Map data: Natural Earth 1:50m outlines keyed by cca3, simplified to 15% of points (163 KB, 52 KB gzipped), plus a marker point per sovereign state. Built by `scripts/build-map.mjs`. |
| `src/data/loadCountries.ts` | Data loading: REST Countries `v3.1/all?fields=…` fetch (cached 24h, falls back to `countries.json`), the sovereign-state rule (193 UN members + Vatican City + Palestine = 195), curated aliases (Ivory Coast, Burma, Holland, UK, DRC…), and `resolveEmpires` (empire name lists to country codes). |
| `src/data/historical_empires.json` | The five empire lists from the project knowledge base, unchanged. |

## Modes

| Mode | Rounds | Targets |
| --- | --- | --- |
| Continents | Africa (54), Americas (35), Asia (47), Europe (45), Oceania (14) | The continent's sovereign states |
| Empires | Roman (43), Mughal (4), Ottoman (38), Soviet (15), British (66) | The modern states listed for that empire in `historical_empires.json` |
| World | World (195) | Every sovereign state |
| Pathfinding | A random start and destination, 3–7 countries apart by land | Countries bordering where you stand |

- **Empire lists:** names are resolved to country codes on the server by exact name or alias, never fuzzily, so a typo in the data can't map to the wrong country. "Turkey" and "The Gambia" resolve through aliases.
- **Kosovo:** listed in the Roman and Ottoman empires but excluded from both rounds, because it isn't one of the 195 states the matcher recognizes. Left in, it would make those rounds impossible to finish.
- **Colors:** each continent or empire round has one color theme for its chips and map fills. World Mode colors each country by its continent.

## Pathfinding

1. **The puzzle:** you get a random start and destination connected by land, with 3–7 countries in between on the shortest route. Neighbouring pairs would be a zero-move round, and the data's longest routes (17 in between) are a slog.
2. **Each step must border the country you're in.** The prompt always says where you are. Typing uses the same `liveMatch` and `ClayInput` as every other mode, with the current country's neighbours as the scope. Naming a country that doesn't border yours says so ("France doesn't border Portugal.").
3. **Stepping back is allowed:** naming a country already on your route cuts the loop off, so the drawn route stays a clean chain. The step still counts as a move.
4. **Finish:** the route is complete as soon as the last country you named borders the destination (or is the destination). The result compares your moves with the shortest route and shows one shortest route.

On the map the start (amber) and destination (rose, pulsing until reached) are labeled and always highlighted, and each step fills in teal. The map is framed around one shortest route.

### The border graph

- Built from each country's `borders` in the country data, between the 195 sovereign states only: borders with Western Sahara, French Guiana, Hong Kong and Kosovo are dropped.
- Only mutual borders count. The data lists India as a neighbour of Sri Lanka but not the reverse; they share no land border, so Sri Lanka stays an island.
- Result: one connected group of 130 countries across Europe, Asia and Africa (joined by Spain–Morocco and Egypt–Israel), 22 in the Americas, and two pairs (Ireland–United Kingdom, Haiti–Dominican Republic). 38 countries have no land border.

## Game loop

1. **Setup:** pick a mode, then a round. Its countries become the targets and the timer starts.
2. **Typing:** every keystroke runs `liveMatch` against the whole world, with the continent as scope.
   - **Complete, unambiguous name:** added on that keystroke. The field clears and springs like a pressed key.
   - **Typo-corrected name:** added once typing pauses for `TYPO_ACCEPT_DELAY_MS` (700 ms). Accepting it instantly would cut the word off: "germa" is already within 2 edits of Germany.
   - **Name that starts another unnamed country** ("Niger" before Nigeria, "uk" before Ukraine): held. After the pause the player sees "Niger: press Enter to add it, or keep typing."
   - **Enter / Check:** accepts any match, or explains why not (outside this continent, already named, ambiguous, not recognized).
   - **Suggestions:** a list under the field (see below). Picking from it accepts at once, with no 700 ms pause.
3. **End:** naming every target wins and **Forfeit** gives up. Either way the timer stops, the time is shown, and a forfeit lists the countries missed. The round is then saved to the profile.

Session state is one reducer: `mode` (`continent` · `historical` · `world` · `pathfinding`), `roundKey`, `targetCodes`, `guesses`, `status` (`setup` · `playing` · `won` · `forfeited`), `round` (the Timer and map key), `elapsedMs`, `hintsUsed`, `hintTargets`, `route`, `moves`, `attempts` (every committed answer, rejected ones included) and `assisted`.

## Suggestions (autocomplete)

The list always searches the whole world: all 195 countries and their aliases (or all capitals in Capitals mode), whatever the round, including countries already named. It never narrows down which answers count. Picking one that doesn't count is explained like a typed answer ("Brazil isn't in Europe.", "Belgium is already on your list.", "Brazil doesn't border Portugal.") and the list closes so the message can be read. It can be switched off with the **Suggestions** button in the answer card (the choice is saved), and a round in which the list showed any answer is saved as **assisted**.

Ranking (`suggestCountries`), strictly in this order, up to 8:

1. **Prefix:** the display name starts with the query, alphabetically ("b" → Bahamas, Bahrain, Bangladesh, Barbados…).
2. **Alternate name prefix,** from 2 letters, shown with the name that matched ("bur" → Myanmar *as Burma*).
3. **Substring:** a later word ("guinea" → Equatorial Guinea), or from 3 letters any part of a display name ("stan" → Kazakhstan).
4. **Typo fallback,** from 5 letters, only when nothing starts with the query ("brzil" → Brazil). "congo" doesn't drag in Mongolia.

Keyboard: Down/Up move the highlight, Enter picks it (with nothing highlighted, Enter checks the typed text as before), Escape closes the list. Clicking an option keeps focus in the field. The list springs open (`--spring-snappy`) and tucks back up for 240 ms before unmounting; reduced motion gets a fade.

## Capitals mode

The setup screen's **Name the: Countries / Capitals** switch applies to every list round (continents, empires, World); Pathfinding is always countries. The same matcher runs on an index of capitals (`buildIndex(countries, "capitals")`), so typo tolerance, live acceptance, holds and autocomplete all work unchanged.

- **Data:** the `capital` field from REST Countries (and the snapshot), with curated fixes in `loadCountries.ts`: `CAPITAL_OVERRIDES` where a country has more than one capital the data leaves out (Bolivia: Sucre or La Paz; Eswatini: Mbabane or Lobamba; Sri Lanka: Sri Jayawardenepura Kotte or Colombo; Palestine: Ramallah or East Jerusalem) and `CAPITAL_ALIASES` for other spellings (Kiev, Peking, Nur-Sultan, Washington, Delhi…). South Africa accepts Pretoria, Cape Town or Bloemfontein.
- **Typing a country instead:** "Sweden is a country. Name its capital."
- **Out of scope:** "Brasília is the capital of Brazil. Brazil isn't in Europe."
- **Hints:** stage 1 and 2 point at a country whose capital is missing; stage 3 lists the capitals' initials.
- Measured: typing each of the 201 accepted capitals letter by letter in its own continent, none credits the wrong country and none is accepted before it's complete.

## Daily Challenge

`dailySeed.ts` hashes the date (`geotag:YYYY-MM-DD`, FNV-1a; the salt is `DAILY_SALT` and must not change once the game is live) into a Mulberry32 seed. The first draw picks the kind (a Pathfinding route on about half of days, otherwise a continent, always in Countries mode); the rest pick the route with the normal `pickRoute`, which only draws from sorted lists. So every browser on the same date gets the same puzzle, whatever its locale or the order the data arrived in.

- **Snapshot data only:** the daily is drawn from the bundled `countries.json`, never the live API. `page.tsx` passes `getDailySource()` (codes, continents and borders of the 195 states: 12.6 KB, 2.2 KB gzipped) alongside the live list. Daily routes are also *played* on the snapshot's borders (`Session.borders = "snapshot"`): which moves are legal, when the route is complete, and the share grid all come from it. A daily continent's countries come from the snapshot's regions. Live data can't change the day's puzzle or how it plays.

- The date is the player's **local** date, like Wordle: the puzzle changes at local midnight.
- The first finished attempt each day is the daily result. The card then shows it with a Share button, and **Play again** replays the same puzzle as an ordinary round (not tagged Daily, not shared as Daily).

## Challenge links and NFC tags

Opening `/?route=FRA-CHN` skips the setup screen and starts that route. `RouteChallengeParam` (in `CountryGuesser.tsx`) reads it with `useSearchParams` inside its own `<Suspense>`, so the rest of the page stays in the prerendered HTML.

- **Validation** (`parseRouteParam` in `pathfinding.ts`): any letter case; both codes must be among the 195 countries; not the same country; connected by land; at least one country in between. Anything else falls back to the setup screen with the reason ("XXX isn't a code for one of the game's 195 countries.", "There's no land route from France to United States."). Other query parameters are ignored, and long values are cut short in the message.
- **Same puzzle on every phone:** challenge routes are played on the bundled snapshot's borders, like the Daily Challenge.
- **No flash:** a tiny script in `layout.tsx` hides the setup screen before first paint when the URL has `route=` ("Opening your challenge…"), until the game has read the link. If the game's script never loads, the setup screen comes back after 4 s.
- The parameter is removed from the address bar once read, so a reload or "Choose another round" doesn't relaunch it.
- **Create NFC Challenge** on every Pathfinding result copies `<this page>?route=START-END`. Write it to a tag with any NFC writer app (a plain URL record). Challenge results offer **Play this route again**, and share as "Pathfinding Challenge".

## Share result

Every result screen has a **Share result** button. The text names no countries:

```
geotag - Daily Pathfinding 2026-10-26
🗺️ 5 moves (shortest 4) ⏱️ 01:12
🟩🟩🟨🟩🟩
```

- **Pathfinding:** one square per move. 🟩 one country closer to the destination, 🟨 just as far, 🟥 further (steps back included).
- **List rounds:** up to 10 squares, each a tenth of the round's countries in the order named, by pace: 🟩 up to 6 s per country, 🟨 up to 15 s, 🟥 slower, ⬜ not reached. Hints add 💡 n; a forfeit adds 🏳️.
- A round where suggestions showed adds "🔤 with suggestions".

## Recall heatmap

Each list round now saves every correct answer with the time since the previous one (`answers` in the round record), whether a hint pointed at it (its borders, its outline, or the initials), and whether it was picked from the suggestion list. The profile maps each country's average onto the world map:

- Bands: under 4 s (green), 4–10 s, 10–20 s, over 20 s (red), blank for never named. A hinted answer counts as at least 30 s, so heavily hinted countries go red. Picked answers are recognition, not recall, and don't count. Countries and capitals are mapped separately.
- Green to red as asked, with lightness falling at every step, so the order still reads for red-green color-blind players and in grayscale (checked with the dataviz palette validator; it only objects that the ramp isn't one hue, which green to red can't be).
- Each country has a tooltip, and the legend counts each band. The 5 slowest and 5 fastest are listed with their times, so nothing depends on color alone.
- Rounds saved before this phase have no answer data and don't appear.
- "Time since the previous answer" is a proxy: a long gap may mean you were stuck on anything, not on that country. It gets more reliable with more rounds.

## Passport stamps

| Stamp | Earned by |
| --- | --- |
| Roman Emperor | Completing the Roman Empire (countries or capitals) with no hints and suggestions off |
| Speedrunner | Completing Africa, the Americas, Asia or Europe (more than 30 countries; never Oceania) at under 3 s per country (time ÷ the continent's country count), suggestions off |
| World Traveler | Playing a World round, finished or not |

Earned stamps are thick plastic tokens (a raised rim on a drop shadow, a pressed-in face, embossed lettering); unearned ones are the deep empty impression the token will sit in. All depth is `box-shadow` and `text-shadow`, with no images. The only animation is the press-in when the tab opens (transform and opacity). Stamps count every saved round, whatever the profile filter, and are dated from the first round that earned them.

## Profile & Stats

Each finished or forfeited round is saved once, after the Timer reports the final time: mode, round, result, time, guesses made, countries named, hints used, moves and shortest route (Pathfinding), whether suggestions showed, and a timestamp. The tab shows:

- **Tiles:** games played, rounds won (with win rate), total time played.
- **Average winning time by mode:** one bar per mode, with seconds per country (or moves over the shortest route) underneath. Forfeits are left out of the averages.
- **Personal bests:** fastest win for each continent, empire and World. Routes are random, so they have none.
- **Recent rounds:** the latest 20, tagged Won/Forfeited, Daily, Best and Suggestions. Capitals rounds keep their own personal bests ("Oceania capitals").
- **Filter:** all rounds, without suggestions, or with suggestions.

## Hints (3 per round, each builds on the last)

1. **Neighbours:** names the land neighbours of one missing country. The country is chosen to give away the fewest *other* answers: neighbours already named, or outside the round, don't count. If no missing country has a land border, it says the country is an island nation.
2. **Outline:** that same country pulses on the map (a pulsing ring for dot-marked microstates). If it was already found, another missing country pulses instead.
3. **Initials:** initials of every country still missing ("B.F." for Burkina Faso). The list shrinks as you name them.

Naming a hinted country is confirmed in the panel and stops its pulse. The result line reports hints used.

## Map

- **Data:** Natural Earth 1:50m. The usual 1:110m file has no shape at all for 29 sovereign states (8 of Oceania's 14). At 1:50m only Tuvalu is missing.
- **Framing:** every round has its own frame and center longitude. Rome is centered on the Mediterranean, the Mughal Empire on South Asia, the Ottomans run from the Balkans to the Horn of Africa, and the Soviet Union from the Baltic to the Bering Strait. The British Empire and World Mode show the whole world. Oceania and the Soviet Union stay in one piece across the 180° meridian.
- **Frames are set per round, not computed:** a box computed from country centers would follow Russia's center point into Siberia for the Ottoman round, and the British Empire spans every longitude. A test checks that every country in all 11 rounds is on screen.
- **Small countries:** anything too small to see also gets a dot that fills and pulses like an outline. At continent zoom that means under 40 square units. Zoomed out, the threshold and dot shrink: World Mode gets 40 dots instead of 78, and the Netherlands, Belgium and Switzerland show as shapes.
- **Clay depth:** SVG filters (outer drop shadow plus light top-left and dark bottom-right inner edges), one per layer rather than per path. CSS `drop-shadow()` can't draw inset edges.
- **Performance:** a newly named country pops on an unfiltered layer, then joins the clay layer when its spring settles. Popping inside a filtered layer made Chromium re-run the filter every frame, measured at 12 fps instead of 60.
- **Loading:** the map code and data are a separate 62 KB (gzipped) chunk, fetched while the player is on the setup screen.

### Why the live rules exist (measured on all 195 countries, each typed letter by letter in its own continent)

| Policy | Correct spelling: wrong country credited | Correct spelling: cut off mid-word | One random typo (3,900 samples): wrong country credited |
| --- | --- | --- | --- |
| Accept any match on every keystroke | 7 (Nigeria→Niger, Ukraine→UK, Zimbabwe→Zambia, Turkmenistan→Türkiye…) | 81% | 3.3% |
| `liveMatch` | 0 | 0 | 0 |

With `liveMatch`, 191 of 195 correctly spelled names land on their last keystroke with no Enter. The other 4 (Niger, Guinea, Congo, Dominica) need Enter while their longer neighbour is unnamed. Each keystroke takes 0.5 ms median to process in the browser (p95 3.1 ms).

## Clay theme

- **Depth:** every surface uses the same 4-layer recipe: a tight contact shadow, a soft drop shadow, a light top-left inset, and a dark bottom-right inset. Pressed states flip the two insets. Recipes keep the same layer order, so states interpolate smoothly.
- **Motion:** springs are real damped-oscillator curves sampled into CSS `linear()` (`--spring-snappy`, `--spring-bouncy`, `--spring-gentle`). Browsers without `linear()` get a single-overshoot `cubic-bezier`. `prefers-reduced-motion` swaps all springs for a short fade and turns off the input press.
- **Color:** chip and continent-button fills use atlas pastels per continent. All text is at least 5:1 contrast.
- **Light only:** `color-scheme: light`. There is no dark theme.

## Matching rules (`matchCountry`)

1. **Normalize**: lowercase, strip accents, `&`→`and`, `St`→`Saint`, drop apostrophes/punctuation and a leading "the".
2. **Exact hit wins**: if the normalized input equals any name or alias, that country is returned. "Niger" never becomes "Nigeria".
3. **Fuzzy fallback** (Levenshtein via `fastest-levenshtein`), with tolerance scaled to name length:
   ≤3 chars: exact only · 4–5: 1 edit · 6–9: 2 edits · 10+: 3 edits.
   A single swap of two adjacent letters ("Mlai") counts as 1 edit, not Levenshtein's 2. Without this, "mlai" scored as close to Malawi as to Mali, and the wrong country won.
4. **Ambiguity guard**: if two countries tie for closest, nothing is accepted. "Irak" is 1 edit from both Iran and Iraq, so the player is asked to type more.
5. **Scope** (for continent rounds): matching always runs against the whole world first. Scope only breaks ties, and an exact out-of-scope answer returns `out_of_scope`. This stops "Austria" from being auto-corrected to "Australia" in an Oceania round.

Result statuses: `match` · `ambiguous` · `out_of_scope` · `no_match` (`empty` | `too_short` | `not_found`).

### Measured accuracy

| Input | Variants | Credited to the wrong country |
| --- | --- | --- |
| One typo (delete, insert, substitute, or swap one letter) | 93,122 | 0 |
| Two random typos | ~28,800 (sampled) | ~0.7% |

Two-typo misses are mostly inputs that genuinely sit closer to another name ("austaia" is 1 edit from Austria, 2 from Australia). No edit-distance metric can recover those.

## Known limits

- A round counts as "with suggestions" once the list has shown any answer, even if none was picked. Such rounds can't earn Roman Emperor or Speedrunner, so switch Suggestions off before typing.
- NFC tags written with a localhost or preview URL only work on that machine or deployment. Write tags from the production site.
- The profile lives in one browser. It doesn't sync between devices, and clearing site data erases it. Safari deletes script-written storage, IndexedDB included, for sites not visited in 7 days, unless the site is added to the Home Screen.
- "Average time per mode" mixes round sizes: a Continents average blends Oceania (14) and Africa (54). Seconds per country and personal bests are the comparable numbers.
- Suggestions don't narrow the answers down, but they still jog your memory ("b" lists every B country), so assisted times aren't comparable with unassisted ones. Use the filter.
- The Daily Challenge is identical for everyone running the same deployment: it uses the bundled snapshot, so refreshing the snapshot (`npm run snapshot`) and redeploying can change future dailies. Do that between days, not mid-day.
- "Same for everyone" means the same local date. Players east of you get the next puzzle first and can share it before you've played.
- Disputed capitals follow the data: Israel's is Jerusalem, and Palestine's accepts Ramallah or East Jerusalem.
- The brand name lives in one constant, `BRAND_NAME` in `src/utils/share.ts`: the page `<title>`, the header and the share text all read it. The IndexedDB database keeps its original internal name (`country-recall`) so existing saved profiles aren't lost; players never see it.
- Pathfinding treats each country as one place, so routes can cross water inside a country: Thailand → Malaysia → Indonesia → Papua New Guinea is legal because Malaysia borders Thailand on the mainland and Indonesia on Borneo. Spain–Morocco counts through Ceuta and Melilla.
- The pathfinding map is framed around one shortest route; a long detour can wander past its edges.
- Pathfinding has no hints: all three hint stages are built for "name every country" rounds.
- The empire lists are the game's answer key, taken as given. Worth a historical review: see "Empire data to review" below.
- The Mughal round has only 4 countries, so it lasts seconds.
- Stage 1 still reveals unnamed neighbours when every candidate has some (early in a round, usually 1–2 names).
- Neighbour lists only include sovereign states: Morocco's hint omits Western Sahara, Brazil's omits French Guiana.
- Stage 2 is visual only. Screen-reader users get its text but not the outline.
- A typo'd answer needs a 0.7 s pause (or Enter) before the next country. If the player types straight on, the two words run together in the field.
- The 700 ms pause is tuned by feel, not measured with players.
- Continents follow the dataset's regions: "Americas" is one round (35 countries), and borderline cases follow the data (Türkiye, Armenia, Georgia and Azerbaijan are Asia; Russia and Cyprus are Europe).
- The swap rule covers exactly one swap. A swap plus another typo still costs 3 edits.
- Taiwan and Kosovo are excluded by the UN-based definition. Add their codes to `UN_OBSERVER_STATES` in `loadCountries.ts` to include them.
- The dataset marks Vatican City `unMember: true` (it is a UN observer). The 195 count is still correct because Vatican City is included either way. Don't rely on `unMember` alone elsewhere.
- The bundled `countries.json` was generated from the mledoze/countries dataset, which uses the same field structure REST Countries serves. Run `npm run snapshot` to replace it with a live pull.

## Empire data to review

The app uses `historical_empires.json` exactly as provided. These entries look doubtful; edit the file to change them:

- **British Empire omits** the United States (the Thirteen Colonies), Mauritius and Seychelles, all of which were British territory.
- **Ottoman Empire omits** Croatia (Slavonia was Ottoman for about 150 years) and Slovakia (Ottoman Uyvar province). It **includes** the United Arab Emirates, which the Ottomans never ruled; Oman and Bahrain are also doubtful.
- **Roman Empire includes** Moldova, which lay outside Roman Dacia. It **omits** Saudi Arabia, whose northwest (Hegra) was in the province of Arabia Petraea.
