# geotag

Next.js (App Router, TypeScript) geography game. Pick a round (a continent, a historical empire, or the whole world), then name every sovereign state in it against a running clock. Or play Pathfinding: cross from one country to another by naming land neighbours. Answers are recognized as you type, typos and alternate names included. Named countries fill in on a clay map, and three progressive hints help when you're stuck. An optional autocomplete list suggests answers, and every finished round is saved to a local profile (IndexedDB) with stats on the setup screen's **Profile & Stats** tab. List rounds can be played for **capitals** instead of countries, a seeded **Daily Challenge** gives everyone the same puzzle each day, and results can be shared as a spoiler-free emoji grid.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # matcher, timer and game-flow tests, run against the real country data
npm run snapshot   # maintenance only: re-pull countries.json from REST Countries, then rebuild
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
| `src/components/game/SvgMap.tsx` | Inline SVG map (d3-geo projection, no canvas/WebGL). Frames each continent, fills named countries, pulses the stage-2 hint, and takes a static color per country (`fills`) for the heatmap. Optional clicks (`clickable`, `onCountryClick`, `selected`). Memoized and lazy-loaded. |
| `src/components/game/MapTooltip.tsx` | The clay tooltip shown by a map tap: absolutely positioned at the tap, kept inside the map, springs open. No library. |
| `src/components/game/HintPanel.tsx` | "Get a hint (n/3)" button and revealed hints, plus the pure helpers `pickHintTarget` and `initialsOf`. |
| `src/components/game/DailyCard.tsx` | The setup screen's Daily Challenge card: today's puzzle, and once played, the first result with its Share button. |
| `src/components/game/ShareResult.tsx` | "Share result": copies the share text with `navigator.clipboard.writeText`; if the clipboard is unavailable the text stays visible to copy by hand. |
| `src/components/game/SplashScreen.tsx` | Boot-up screen: the full logo, the coral PLAY button and a loader. PLAY unlocks once IndexedDB is open and the map data has loaded. |
| `src/components/game/QrShareModal.tsx` | "Share via QR": a native modal `<dialog>` with the route's challenge link as a QR code (`qrcode.react`'s `QRCodeSVG`), pressed into a clay well. Loaded on demand. |
| `src/components/game/ProfilePanel.tsx` | The Profile & Stats tab: passport stamps, stat tiles, average winning time per mode (clay bar chart), the recall heatmap (reusing `SvgMap`), personal bests, recent rounds, clear history. Pure helpers `recallStats`, `recallBand`, `stampProgress`, `personalBests`. |
| `public/fonts/` | Fredoka variable font (Latin subset, 68 KB) and its OFL license. Self-hosted, no runtime Google Fonts call. |
| `src/utils/fuzzyMatch.ts` | Matching: `normalize`, `buildIndex` (country names, or capitals with `"capitals"`), `matchCountry`, `liveMatch` (per-keystroke rules), `suggestCountries` (autocomplete ranking), `answerForInput`, and the `Country` type. |
| `src/utils/haptics.ts` | `vibrate()` (30 ms, feature-checked, never throws), `canVibrate()` and `hapticsUseful()` (the API exists and the pointer is coarse). |
| `src/utils/dailySeed.ts` | Mulberry32 PRNG, FNV-1a hash of the date, `dateKey` (local YYYY-MM-DD) and `dailyChallenge` (seeded route or continent). |
| `src/utils/share.ts` | Spoiler-free share text: `routeGrid`, `paceGrid`, `buildShareText`. |
| `src/utils/db.ts` | Local profile in raw IndexedDB (database `country-recall`, stores `rounds` and `settings`): `saveRound`, `listRounds`, `clearRounds`, `getSetting`/`setSetting`, and the pure `summarize`. Every call fails soft when storage is unavailable. |
| `src/utils/pathfinding.ts` | Land-border graph (`buildBorderGraph`), breadth-first search (`bfsDistances`, `shortestPath`), route puzzles (`pickRoute`) and step rules (`applyStep`, `reachesEnd`). |
| `src/data/countries.json` | Country data: the app's only source, bundled at build time (the REST Countries fields the app uses). Nothing is fetched at runtime. |
| `src/data/world-map.json` | Map data: Natural Earth 1:50m outlines keyed by cca3, simplified to 15% of points (163 KB, 52 KB gzipped), plus a marker point per sovereign state. Built by `scripts/build-map.mjs`. |
| `src/data/loadCountries.ts` | Data loading: `getSovereignStates()` reads `countries.json` (no network), the sovereign-state rule (193 UN members + Vatican City + Palestine = 195), curated aliases (Ivory Coast, Burma, Holland, UK, DRC…), and `resolveEmpires` (empire name lists to country codes). |
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
5. **Give Up:** a small, recessed button under the map while the route is on (routes have no Forfeit button: this replaces it). It stops the timer at once, ends the route, and shows in red (`--route-missed`) the countries of one shortest route you never stepped into, with a key under the map; the result card lists the whole route by name.
6. **Generate New Route:** on the result card, next to Share via QR (stacked on narrow phones). It draws a new random route and starts it immediately, without going back to the menu.

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
3. **End:** naming every target wins and **Forfeit** (Give Up in Pathfinding) gives up. Either way the timer stops, the time is shown, and a forfeit lists the countries missed. The round is then saved to the profile.

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

- **Data:** the `capital` field in `countries.json`, with curated fixes in `loadCountries.ts`: `CAPITAL_OVERRIDES` where a country has more than one capital the data leaves out (Bolivia: Sucre or La Paz; Eswatini: Mbabane or Lobamba; Sri Lanka: Sri Jayawardenepura Kotte or Colombo; Palestine: Ramallah or East Jerusalem) and `CAPITAL_ALIASES` for other spellings (Kiev, Peking, Nur-Sultan, Washington, Delhi…). South Africa accepts Pretoria, Cape Town or Bloemfontein.
- **Typing a country instead:** "Sweden is a country. Name its capital."
- **Out of scope:** "Brasília is the capital of Brazil. Brazil isn't in Europe."
- **Hints:** stage 1 and 2 point at a country whose capital is missing; stage 3 lists the capitals' initials.
- Measured: typing each of the 201 accepted capitals letter by letter in its own continent, none credits the wrong country and none is accepted before it's complete.

## Daily Challenge

`dailySeed.ts` hashes the date (`geotag:YYYY-MM-DD`, FNV-1a; the salt is `DAILY_SALT` and must not change once the game is live) into a Mulberry32 seed. The first draw picks the kind (a Pathfinding route on about half of days, otherwise a continent, always in Countries mode); the rest pick the route with the normal `pickRoute`, which only draws from sorted lists. So every browser on the same date gets the same puzzle, whatever its locale or the order the data arrived in.

- **One data set:** the daily is drawn from, and played on, the same bundled `countries.json` as every other round. Nothing is fetched, so every player of the same deployment gets the same data and the same puzzle.

- The date is the player's **local** date, like Wordle: the puzzle changes at local midnight.
- The first finished attempt each day is the daily result. The card then shows it with a Share button, and **Play again** replays the same puzzle as an ordinary round (not tagged Daily, not shared as Daily).

## Challenge links and QR sharing

Opening `/?route=FRA-CHN` skips the setup screen and starts that route. `RouteChallengeParam` (in `CountryGuesser.tsx`) reads it with `useSearchParams` inside its own `<Suspense>`, so the rest of the page stays in the prerendered HTML.

- **Validation** (`parseRouteParam` in `pathfinding.ts`): any letter case; both codes must be among the 195 countries; not the same country; connected by land; at least one country in between. Anything else falls back to the setup screen with the reason ("XXX isn't a code for one of the game's 195 countries.", "There's no land route from France to United States."). Other query parameters are ignored, and long values are cut short in the message.
- **Same puzzle on every phone:** every copy of the game plays on the same bundled border data.
- **No flash:** a tiny script in `layout.tsx` hides the setup screen before first paint when the URL has `route=` ("Opening your challenge…"), until the game has read the link. If the game's script never loads, the setup screen comes back after 4 s.
- The parameter is removed from the address bar once read, so a reload or "Choose another round" doesn't relaunch it.
- **Share via QR** on every Pathfinding result opens a modal with a QR code for `<this page>?route=START-END`, built from `window.location.origin` so it matches wherever the game is running. Another phone scans it with its camera and lands straight in the route. Challenge results offer **Play this route again**, and share as "Pathfinding Challenge".
  - The modal is a native `<dialog>` opened with `showModal()`: it sits in the browser's top layer, centered in the viewport however far the page is scrolled, keeps keyboard focus inside, closes on Escape, Close or a tap on the backdrop, and returns focus to the button.
  - The code is a single SVG `<path>`, drawn once and never animated. Only the card springs in (transform and opacity), and the backdrop is a flat tint (no blur). The QR library (`qrcode.react` 4.2.0, no dependencies) is in its own chunk, fetched while the result screen is showing.
  - Error correction M with a 2-module quiet zone, dark ink on a flat white face, kept clear of the well's inset shadow so the camera sees crisp modules.

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

## Haptics

A 30 ms buzz (`navigator.vibrate([30])`) on PLAY, on a map tap that shows a country, and when a route is completed. Every call is feature-checked (`typeof navigator.vibrate === "function"`) and wrapped in try/catch, so unsupported browsers do nothing.

- **Where it works:** Chrome-based browsers on Android. No iPhone or iPad browser has the Vibration API, and desktops have nothing to vibrate. Browsers also ignore it until the person has tapped or typed on the page.
- **The toggle** (a phone icon at the right of the logo row) is shown only where it can do something: the API exists and the main pointer is a finger (`(pointer: coarse)`). It's on by default; turning it off is saved in IndexedDB (`haptics` setting), and turning it back on gives one buzz.

## Boot-up splash and logo

**Brand files** live in `/public` and ship with the code. Neither is checked for: both are always used.

| File | Used for |
| --- | --- |
| `public/logo.png` (transparent, 511×168) | Header logo: the "geotag" wordmark alone, straight on the page background with a soft drop-shadow, 48px tall, 56px from 768px wide up. Its alt text ("geotag") names the heading. |
| `public/assets/logo-full.webp` (transparent, 719×900) | Splash logo: the mascot in its ring over the wordmark. A plain image (no video, no frame, no clipping): the card's full width, height following, capped at 16rem (256px), with a soft drop-shadow. Its alt text ("geotag") names the splash dialog. |

Without either file, its spot shows a broken image. Both were cut from the supplied artwork (a JPEG with the peach-lavender gradient baked in): the gradient was modelled and matted out, so the soft shadows stay as transparent shadows, and everything inside the ring was kept opaque. A transparent export from the original source would be cleaner; drop it in at the same paths and sizes. The cutouts are made for light backgrounds: on a dark one, the matted shadows read as a pale glow.

**The sequence:** the splash is in the server HTML, so it covers the game from the first paint. The logo springs in (transform and opacity). PLAY shows a dotted loader and stays locked until the profile database is open and the map chunk has loaded (8 s at most, then it unlocks anyway: the game works without either). PLAY, or Enter/Space, fades the splash out while its card scales to 105% over 500 ms, transform and opacity only, and focus moves to the game's heading.

- **Focus:** the splash is a labelled modal dialog, and focus starts on the dialog itself, not on PLAY. So no focus ring shows at launch; screen readers announce the dialog ("geotag", "Tap to start your adventure"); Enter or Space starts the game; and Tab reaches PLAY, whose ring then shows (keyboard focus only: a tap or click never shows it).
- **Focus trap:** while the splash is up, the game behind it is `inert`: keyboard focus can't reach it and screen readers don't see it.
- **Challenge links skip the splash:** a scanned `?route=` link goes straight into the route (the inline script in `layout.tsx` hides the splash before first paint), so the timer never runs behind it.

## Map taps

The map only answers taps when that can't be used to cheat:

| When | What's tappable | A tap shows |
| --- | --- | --- |
| During a round, fewer than 3 hints | Nothing | — |
| During a list round, all 3 hints used | The round's countries | A missing country: only its initials ("P. N. G."), or its capital's initials in Capitals mode. A named one: its name (and the capital you gave). |
| During a route | Nothing (routes have no hints) | — |
| After a round (won or forfeited) | Every country on the map | Its name, plus its capital(s) in Capitals mode |

- **One listener:** `SvgMap` takes a single `onClick` on the `<svg>` and reads the tapped element's `data-code`, instead of ~240 handlers. Clickable shapes get `data-clickable` (pointer cursor), and small countries drawn as dots get an invisible tap target three times the dot's size.
- **Phones:** the tooltip stays up after the finger lifts. It closes on the next tap elsewhere (or on the sea), on Escape, or when the round changes. Tapping the map doesn't take focus from the answer field, so the keyboard stays up.
- **60 fps:** the tooltip springs open on transform and opacity only. The tapped country's outline is drawn on its own layer outside the map's SVG filters, so nothing re-runs a filter.
- The stage-3 hint and a note under the map say when the map is tappable. Initials are now written with spaces everywhere ("B. F.").
- Map taps are pointer-only. Keyboard and screen-reader players get the same information from the stage-3 hint list and the result screen's lists.

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
- A QR code made on `localhost` points at the scanning phone's own localhost, so it can't be opened elsewhere; the modal says so. Test phone-to-phone from the deployed site, or open the dev server by its network address (e.g. `http://192.168.1.20:3000`) with both phones on the same Wi-Fi. Vercel preview deployments may ask the scanning phone to log in if Deployment Protection is on; production links don't.
- The profile lives in one browser. It doesn't sync between devices, and clearing site data erases it. Safari deletes script-written storage, IndexedDB included, for sites not visited in 7 days, unless the site is added to the Home Screen.
- "Average time per mode" mixes round sizes: a Continents average blends Oceania (14) and Africa (54). Seconds per country and personal bests are the comparable numbers.
- Suggestions don't narrow the answers down, but they still jog your memory ("b" lists every B country), so assisted times aren't comparable with unassisted ones. Use the filter.
- The Daily Challenge is identical for everyone running the same deployment: it uses the bundled `countries.json`, so refreshing it (`npm run snapshot`) and redeploying can change future dailies. Do that between days, not mid-day.
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
- The bundled `countries.json` was generated from the mledoze/countries dataset, which uses the same field structure REST Countries serves. `npm run snapshot` replaces it with a fresh pull from REST Countries; that's a maintenance step run on your machine, never by the app.
- **No network at runtime:** the page is fully static (built once, no revalidation), and no app code calls `fetch` or any other network API. A test (`loadCountries.test.ts`, "offline-first guard") fails if one is added. The page itself still has to be loaded once from the server: there's no service worker, so it doesn't open offline.

## Empire data to review

The app uses `historical_empires.json` exactly as provided. These entries look doubtful; edit the file to change them:

- **British Empire omits** the United States (the Thirteen Colonies), Mauritius and Seychelles, all of which were British territory.
- **Ottoman Empire omits** Croatia (Slavonia was Ottoman for about 150 years) and Slovakia (Ottoman Uyvar province). It **includes** the United Arab Emirates, which the Ottomans never ruled; Oman and Bahrain are also doubtful.
- **Roman Empire includes** Moldova, which lay outside Roman Dacia. It **omits** Saudi Arabia, whose northwest (Hegra) was in the province of Arabia Petraea.
