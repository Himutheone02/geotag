# geotag


Next.js (App Router, TypeScript) geography game. Pick a round (a continent, a historical empire, or the whole world), then name every sovereign state in it against a running clock. Or play Pathfinding: connect two countries by naming land neighbours, building from either end, on a map hidden in fog. Vexillology Mode shows flags one at a time to name, and Weak Spots builds a practice round from the countries you're slowest at. Answers are recognized as you type, typos and alternate names included. Named countries fill in on a clay map, and two hints per round help when you're stuck. An optional autocomplete list suggests answers, and every finished round is saved to a local profile (IndexedDB) with stats under **Profile \& Stats** in the header. List rounds can be played for **capitals** instead of countries, two seeded **Daily Challenges** (Daily Guessing and Daily Pathfinding) give everyone the same puzzles each day, unlocking at local midnight, and results can be shared as a spoiler-free emoji grid.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # matcher, timer and game-flow tests, run against the real country data
npm run snapshot   # maintenance only: re-pull countries.json from REST Countries, then rebuild
npm run build:map  # rebuild src/data/world-map.json (run after a snapshot refresh)
```
## Recent Updates

Transforming this project into a premium, offline-first Progressive Web App (PWA).



\*\*New Game Modes \& Features\*\*

\* \*\*Vexillology (Flags):\*\* High-resolution SVG offline flag guessing using the core country-matcher and hint system.

\* \*\*Weak Spots Practice:\*\* A custom practice round dynamically generated from the player's personal IndexedDB recall heatmap (targeting the 10 slowest or never-named countries).

\* \*\*Daily Archive:\*\* Replay past Daily Guessing and Pathfinding puzzles without affecting active daily streaks.

\* \*\*Aggregated Hints:\*\* Guessing modes now feature live, dynamic frequency counts for "Remaining Starting Letters" and "Remaining Name Lengths" without penalizing spatial recall data.



\*\*Mechanics \& UI Polish\*\*

\* \*\*Mobile Viewport Script:\*\* Engineered a custom visual viewport calculator to prevent the iOS/Android virtual keyboard from hiding the map during gameplay.

\* \*\*Web Audio API Feedback:\*\* Implemented mathematically synthesized offline audio (pops and thuds) for tactile feedback without relying on external `.mp3` payloads.

\* \*\*Live Pathfinding Colors:\*\* Guesses in Pathfinding mode now evaluate instantly (Green/Yellow/Red) against the shortest route algorithm. 

\* \*\*Pathfinding Limits:\*\* Capped daily Pathfinding moves to `Shortest Route + 4` to prevent brute-forcing.

\* \*\*Historical Accuracy:\*\* Overhauled Empire Mode data to strictly include territories under direct rule at any point in history, complete with dynamic historical context tooltips.


## How it fits together

|File|Role|
|-|-|
|`src/app/page.tsx`|Server Component: loads the countries and renders the game.|
|`src/app/layout.tsx`|Root layout: title, `<link rel="manifest">`, icons (incl. the Apple touch icon), theme color, the challenge-link pre-paint script, and the service worker registration.|
|`src/app/ServiceWorkerRegistration.tsx`|Client component (renders nothing): registers `/sw.js?v=<build id>` after the page loads, in production builds only, then hands the worker the list of files the page has loaded.|
|`public/sw.js`|The service worker: plain JavaScript, no libraries. See "Install and offline".|
|`public/manifest.json`, `public/icons/`|Web app manifest (standalone, lilac theme) and square app icons made from the mascot: 192, 512, 512 maskable, 180 for Apple, 64 favicon.|
|`src/app/CountryGuesser.tsx`|Interactive client component: rounds (continent, empire, world), game session reducer (`sessionReducer`), setup with the mode switch, live typing, results. Must be its own file because `"use client"` applies to a whole file.|
|`src/app/globals.css`|The whole claymorphic theme: every design token (color, shadows, radii, springs, type, space) in `:root`, plus component and game styles.|
|`src/components/ui/ClayCard.tsx`|Extruded container (`as` picks the element).|
|`src/components/ui/ClayInput.tsx`|Clay text field with an always-present label (`hideLabel` hides it visually only). Forwards `ref` (React 19). Given `suggestions`, it becomes an ARIA combobox with a floating `ClayCard` list (arrows, Enter, Escape, click).|
|`src/components/ui/ClayButton.tsx`|Clay button, `primary` or `soft`, `md` or `sm`; lifts on hover, sinks when pressed.|
|`src/components/game/Timer.tsx`|Isolated count-up stopwatch (MM:SS). Owns its own state, so ticks never re-render the game.|
|`src/components/game/SvgMap.tsx`|Inline SVG map (d3-geo projection, no canvas/WebGL). Frames each continent, fills named countries, draws Pathfinding's fog of war (`fog`) and hint outlines (`revealed`), and takes a static color per country (`fills`) for the heatmap. Optional clicks (`clickable`, `onCountryClick`, `selected`). Memoized and lazy-loaded.|
|`src/components/game/MapTooltip.tsx`|The clay tooltip shown by a map tap: absolutely positioned at the tap, kept inside the map, springs open. No library.|
|`src/components/game/HintPanel.tsx`|The hint card: one button naming the next hint ("Starting Letters (0/2)"), and the hints given so far. Generic: the round passes its own two hints. `HintTally` draws a tally as clay chips; `letterPattern` ("B \_ \_ \_ \_ \_") is for flag hints.|
|`src/utils/hintTally.ts`|The Guessing hints' tallies: `startingLetters` and `nameLengths` over the missing answers, `letterCount`, `tallyText`.|
|`src/components/game/DailyCard.tsx`|One Daily Challenge card (Daily Guessing or Daily Pathfinding): today's puzzle, that daily's stats (played, completed, streak, best), and once played, the first result with its Share button. Also `MidnightCountdown` and `formatCountdown` ("New puzzles in 7 h 12 min").|
|`src/components/game/ArchiveDialog.tsx`|The Daily Archive: every past date's two puzzles in a modal, marked ✓ once played (live or from the archive).|
|`src/components/game/PathfindingIntro.tsx`|The three-card explainer shown once, before a player's first Pathfinding round.|
|`src/utils/sound.ts`|Synthesized sound (Web Audio, no files): `playSound("pop" \| "thud")`, `unlockSound()`, `soundSupported()`.|
|`src/components/game/ShareResult.tsx`|"Share result": copies the share text with `navigator.clipboard.writeText`; if the clipboard is unavailable the text stays visible to copy by hand.|
|`src/components/game/SplashScreen.tsx`|Boot-up screen: the full logo, the coral PLAY button and a loader. PLAY unlocks once IndexedDB is open and the map data has loaded.|
|`src/components/game/PartyBoard.tsx`|Party Mode's leaderboard and `rankParty` (finishers by time, then moves; players who gave up last, unranked).|
|`src/utils/scoreCard.ts`|"Save Score": draws the won route's card on a `<canvas>` (`renderScoreCard`), copies the live map with its computed styles inlined (`mapForExport`), names the file, and downloads the PNG.|
|`src/components/game/QrShareModal.tsx`|"Share via QR": a native modal `<dialog>` with the route's challenge link as a QR code (`qrcode.react`'s `QRCodeSVG`), pressed into a clay well. Loaded on demand.|
|`src/components/game/ProfileDialog.tsx`|Profile \& Stats, opened from the header: `ProfilePanel` in a native modal `<dialog>` (Escape or Close, focus back to the button).|
|`src/components/game/ProfilePanel.tsx`|Profile \& Stats: passport stamps, stat tiles, average winning time per mode (clay bar chart), the recall heatmap (reusing `SvgMap`), personal bests, recent rounds, clear history. Pure helpers `recallStats`, `recallBand`, `stampProgress`, `personalBests`.|
|`public/fonts/`|Fredoka variable font (Latin subset, 68 KB) and its OFL license. Self-hosted, no runtime Google Fonts call.|
|`src/utils/fuzzyMatch.ts`|Matching: `normalize`, `buildIndex` (country names, or capitals with `"capitals"`), `matchCountry`, `liveMatch` (per-keystroke rules), `suggestCountries` (autocomplete ranking), `answerForInput`, and the `Country` type.|
|`src/utils/viewport.ts`|`watchVisualViewport()`: mirrors the visual viewport onto `<html>` (`--vv-height`, `--vv-top`, `data-keyboard` while an on-screen keyboard is up), and the pure `readViewport`. See "Typing on a phone".|
|`src/utils/haptics.ts`|`vibrate()` (30 ms, feature-checked, never throws), `canVibrate()` and `hapticsUseful()` (the API exists and the pointer is coarse).|
|`src/utils/dailySeed.ts`|Mulberry32 PRNG, FNV-1a hash of the date, `dateKey` (local YYYY-MM-DD), the two dailies (`dailyGuessing`, `dailyPathfinding`, each with its own seed), and local-midnight and calendar helpers (`startOfLocalDay`, `nextLocalMidnight`, `addDays`, `dayNumber`). Daily Guessing is dealt from a seeded deck (see Daily Challenges).|
|`src/utils/share.ts`|Spoiler-free share text: `routeGrid`, `paceGrid`, `buildShareText`.|
|`src/utils/db.ts`|Local profile in raw IndexedDB (database `country-recall`, version 3, stores `rounds`, `settings`, `party` and `dailies`): `saveRound`, `listRounds`, `clearRounds`, `getSetting`/`setSetting`, `savePartyResult`/`listPartyResults`, `saveDaily`/`listDailies`, and the pure `summarize` and `dailyStats`. Upgrading keeps existing rounds and settings, and version 3 copies the dailies already played into `dailies`. Every call fails soft when storage is unavailable.|
|`src/utils/pathfinding.ts`|Land-border graph (`buildBorderGraph`), breadth-first search (`bfsDistances`, `shortestPath`), route puzzles (`pickRoute`) and the free-roam rules: `routeFrontier` (what may be named next), `routeComplete` (the named countries join the two ends), and `detourOf` / `detourTable` / `routeVerdict` (how far out of the way a guess is: the live chip colors and the share grid).|
|`src/data/countries.json`|Country data: the app's only source, bundled at build time (the REST Countries fields the app uses). Nothing is fetched at runtime.|
|`src/data/world-map.json`|Map data: Natural Earth 1:50m outlines keyed by cca3, simplified to 15% of points (163 KB, 52 KB gzipped), plus a marker point per sovereign state. Built by `scripts/build-map.mjs`.|
|`src/data/loadCountries.ts`|Data loading: `getSovereignStates()` reads `countries.json` (no network), the sovereign-state rule (193 UN members + Vatican City + Palestine = 195), curated aliases (Ivory Coast, Burma, Holland, UK, DRC…), and `resolveEmpires` (empire name lists to country codes, with each list's notes).|
|`src/data/historical\_empires.json`|The five empire lists, corrected to one inclusion rule (see "Empire lists").|
|`src/data/historical\_empire\_notes.json`|For countries only partly in an empire, which part and when ("Hong Kong (1841–1997)…"). Shown on chips and map tooltips.|
|`src/data/flags.ts`|Generated: all 195 flags as SVG markup, keyed by cca3, from flag-icons (MIT; its notice is kept in the file). Loaded on demand as one build file.|
|`scripts/build-flags.mjs`|`npm run build:flags`: rebuilds `flags.ts` from the `flag-icons` dev dependency (pinned to 7.6.0), minified with SVGO.|
|`src/components/game/Flag.tsx`|`loadFlags()` / `useFlags()` (the on-demand flags chunk), `flagSrc()` (a `data:` URL per flag) and `<Flag>`: an `<img>`, so a flag can't run script, with an empty clay slot while loading.|
|`src/utils/weakSpots.ts`|Weak Spots: `recallWithMisses` (each country's average recall time, misses included) and `pickWeakSpots` (the 10 weakest, padded at random).|
|`src/data/empireRule.ts`|`EMPIRE\_RULE`, the inclusion rule's text, shown on the Empires tab. Kept apart so the client bundle doesn't pull in the country data.|

## Modes

|Mode|Rounds|Targets|
|-|-|-|
|Continents|Africa (54), Americas (35), Asia (47), Europe (45), Oceania (14)|The continent's sovereign states|
|Empires|Roman (45), Mughal (4), Ottoman (37), Soviet (17), British (71)|The modern states listed for that empire in `historical\_empires.json`|
|World|World (195)|Every sovereign state|
|Flags|Africa (54), Americas (35), Asia (47), Europe (45), Oceania (14), World (195)|The flag on screen: name its country|
|Weak Spots|10 countries from your own record|The 10 countries shown in white on the map|
|Pathfinding|A random start and destination, 3–7 countries apart by land|Countries bordering your route|

* **Empire lists:** names are resolved to country codes on the server by exact name or alias, never fuzzily, so a typo in the data can't map to the wrong country. "Turkey" and "The Gambia" resolve through aliases.
* **Kosovo:** listed in the Roman and Ottoman empires but excluded from both rounds, because it isn't one of the 195 states the matcher recognizes. Left in, it would make those rounds impossible to finish.
* **Colors:** each continent or empire round has one color theme for its chips and map fills. World Mode colors each country by its continent.

## Pathfinding

Free roam, as in Travle: there is no "where you are".

1. **The puzzle:** you get a random start and destination connected by land, with 3–7 countries in between on the shortest route. Neighbouring pairs would be a zero-move round, and the data's longest routes (17 in between) are a slog.
2. **Any country touching the board counts.** The board is the start, the destination and every country you've named. A guess is valid if it borders any of them, so you can build from both ends at once (`routeFrontier`). Typing uses the same `liveMatch` and `ClayInput` as every other mode, with the frontier (plus the board, so naming it is explained) as the scope. A country that touches nothing yet says so ("Brazil doesn't border your route yet.").
3. **Dead ends are allowed.** A valid guess that leads nowhere still goes on the board and still counts as a move. Naming the start, the destination or a country already named is explained and costs nothing.
4. **Finish:** the route is complete as soon as the named countries join the start to the destination (a breadth-first search inside the board, `routeComplete`). The result compares your moves with the shortest route and shows one shortest route.
5. **Give Up:** a small, recessed button under the map while the route is on (routes have no Forfeit button: this replaces it). It stops the timer at once, ends the route, and shows in red (`--route-missed`) the countries of one shortest route you never named, with a key under the map; the result card lists the whole route by name.
6. **Generate New Route:** on the result card, next to Share via QR (stacked on narrow phones). It draws a new random route and starts it immediately, without going back to the menu.
7. **Daily guess cap:** Daily Pathfinding (and its replays from the Daily Archive) allows the shortest route's length plus 4 moves (`DAILY\_GUESS\_MARGIN`). The counter shows "3 / 11 moves", a line under the prompt counts the guesses left and turns amber at 2, and the last one says so. Running out without joining the ends is a Game Over: "Out of guesses", with the shortest route shown as after a Give Up, shared as `🗺️ ❌ out of guesses (11/11 moves)`. A last guess that joins the route still wins. Random routes and challenge links have no cap; a party on a daily route keeps it for every player.

**First route: a three-card explainer.** Before a player's very first Pathfinding round (random, daily, archive or a scanned challenge link), three short cards explain building from both ends, the fog, and that every guess is a move. Next and Back step through them; Skip, Escape or "Start the route" closes them, and the route (and its timer) starts only then. Seeing them is saved in IndexedDB (`intro-pathfinding`), so they never show again on that device. A route waits until the profile has been read, so a challenge link opened on a first visit still gets the cards.

### Fog of war

While a route is on, the map is one clay silhouette: every country takes the same fill, with a stroke of that same fill to close the seams, so there are no borders between countries (the clay filter still draws the coastlines). Dots for small countries are hidden too, since a dot would give one away. Only the start (violet), the destination (gold, pulsing until reached) and the countries you name (teal, with their borders) are drawn. The fog lifts when the round ends.

Two hints, in order:

1. **Reveal Adjacent:** outlines every country that borders your board right now. The outlines follow the board as it grows.
2. **Reveal All:** lifts the fog: the standard map with every border.

A guess named while its borders were outlined (or any guess after Reveal All) counts as hinted. The map is framed around one shortest route.

### Live colors (Travle rules)

Each guess is judged the moment it's accepted, from how far out of the way it is (`detourTable`: distance from the start, plus distance to the destination, minus the shortest route):

|Verdict|Detour|Chip|Feedback line|
|-|-|-|-|
|On a shortest route|0|green, ✓|"Recognized: Spain: on a shortest route."|
|One country out of the way|1|yellow, ≈|"…: one country out of the way."|
|Off course|2 or more|red, ✕|"…: off course: a route through it is 2 or more countries longer." (as a warning)|

* The icon and a screen-reader label carry the verdict as well as the color; a key under the route explains the three. The start and destination keep their own colors.
* The feedback line says it too, so the verdict is there on a phone with the keyboard up, when the route list is out of view.
* The same verdicts color the share grid (🟩 🟨 🟥).
* In a party, the result screens of players 2 onwards hide the colors along with the shortest route, since they'd give it away.

### Party Mode (pass and play)

Several people play the same route on one device, one after another.

1. On a route's result screen, **Next Player** starts a party. The round just played becomes Player 1's.
2. A hand-over screen ("Player 2, you're up") replaces the result, map and clock, so the next player sees nothing of the last one's route. The clock starts at 00:00 only when they tap **Start**, so passing the device doesn't cost them time. **End party** goes back to the last result.
3. Each player's time and moves are saved in IndexedDB (`party` store, one id per party) and shown as a leaderboard on every result screen: finishers by time (then moves), players who gave up after them, unranked. The player who just finished is highlighted.
4. While the party is on, the result screen hides the shortest route (list and red map), with **Show the shortest route** for afterwards.
5. Only Player 1's round goes into the profile's history and stats; other players' rounds don't. Leaving the route (Generate New Route, Choose another round, a challenge link, reloading the page) ends the party; its results stay stored but aren't shown again.

Player 1's own result screen shows the shortest route before anyone presses Next Player, so the next player should look away (or Player 1 can tap Next Player straight away).

### Save Score

On a won route, **Save Score** downloads a PNG keepsake (1080x1350): the final route map, as a heatmap, as the photo of an off-white instant-photo/trading card with a soft drop shadow on the peach-lavender backdrop, the route, the time in large type, moves, the shortest route's length and the date (and "Player N" in a party), and the geotag logo at the foot. It's drawn with the Canvas API only: the live map's `<svg>` is copied with each element's computed styles written in (an SVG drawn as an image can't see the page's CSS), drawn as an image, and the place names are set on the canvas in Fredoka. No network, no libraries. Browsers that can't draw on a canvas get a message instead.

* **The heatmap:** on the card, each country of the final route is colored by how long it took to find, counted from the step before (any wandering or backtracking in between counts toward the step that followed it). The scale runs from cool cyan (0 s) through pink to hot red (15 s and over), blended in OKLab (`heatColor` in `scoreCard.ts`), and a legend under the time shows it ("fast", the bar, "slow", 0 s to 15 s+). The start and destination keep their violet and gold. The on-screen map is unchanged.

### The border graph

* Built from each country's `borders` in the country data, between the 195 sovereign states only: borders with Western Sahara, French Guiana, Hong Kong and Kosovo are dropped.
* Only mutual borders count. The data lists India as a neighbour of Sri Lanka but not the reverse; they share no land border, so Sri Lanka stays an island.
* Result: one connected group of 130 countries across Europe, Asia and Africa (joined by Spain–Morocco and Egypt–Israel), 22 in the Americas, and two pairs (Ireland–United Kingdom, Haiti–Dominican Republic). 38 countries have no land border.

## Game loop

1. **Setup:** pick a mode, then a round. Its countries become the targets and the timer starts.
2. **Typing:** every keystroke runs `liveMatch` against the whole world, with the continent as scope.

   * **Complete, unambiguous name:** added on that keystroke. The field clears and springs like a pressed key.
   * **Typo-corrected name:** added once typing pauses for `TYPO\_ACCEPT\_DELAY\_MS` (700 ms). Accepting it instantly would cut the word off: "germa" is already within 2 edits of Germany.
   * **Name that starts another unnamed country** ("Niger" before Nigeria, "uk" before Ukraine): held. After the pause the player sees "Niger: press Enter to add it, or keep typing."
   * **Enter / Check:** accepts any match, or explains why not (outside this continent, already named, ambiguous, not recognized).
   * **Suggestions:** a list under the field (see below). Picking from it accepts at once, with no 700 ms pause.
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

* **Data:** the `capital` field in `countries.json`, with curated fixes in `loadCountries.ts`: `CAPITAL\_OVERRIDES` where a country has more than one capital the data leaves out (Bolivia: Sucre or La Paz; Eswatini: Mbabane or Lobamba; Sri Lanka: Sri Jayawardenepura Kotte or Colombo; Palestine: Ramallah or East Jerusalem) and `CAPITAL\_ALIASES` for other spellings (Kiev, Peking, Nur-Sultan, Washington, Delhi…). South Africa accepts Pretoria, Cape Town or Bloemfontein.
* **Typing a country instead:** "Sweden is a country. Name its capital."
* **Out of scope:** "Brasília is the capital of Brazil. Brazil isn't in Europe."
* **Hints:** Starting Letters and Name Lengths count the missing capitals, not the countries (see Hints).
* Measured: typing each of the 201 accepted capitals letter by letter in its own continent, none credits the wrong country and none is accepted before it's complete.

## Vexillology Mode (Flags)

One flag at a time, shown big as a clay tile, for one region (a continent, or all 195). Type the country it belongs to.

* **Same machinery:** the same matcher, field, live acceptance, typo tolerance and suggestions as every round. The only answer that counts is the flag on screen: another country, even one in the region, gets "Not Kenya. Try again, or skip this flag." Always country names, even with Capitals selected.
* **Skip** sends the flag on screen to the back of the line (the order is shuffled each round).
* **Hints:** each flag gets its own two, both about it: Capital City ("Its capital is Nairobi."), then First Letter ("K \_ \_ \_ \_"). The result counts every hint used in the round.
* **Map:** the region's map fills in as you name flags, so you see where each one is. On a phone the flag comes first; with the keyboard up, the flag takes the map's place above the field.
* **Results:** missed and named lists show each flag next to its country. Share text: `geotag - Europe flags`, 🚩.
* **Flags:** [flag-icons](https://github.com/lipis/flag-icons) 7.6.0 (MIT), 4:3, chosen over smaller sets because it keeps emblems legible at this size (Bhutan's dragon, Mexico's eagle) and has current designs (Syria's 2025 flag, Kyrgyzstan's 2023 sun). `npm run build:flags` writes all 195 into `src/data/flags.ts`, minified with SVGO (which saves little: the files are already tight, and the size is real detail: Serbia alone is 175 KB). The ISO alpha-2 code for each comes from `countries.json`.
* **Size and offline:** about 1.2 MB, 395 KB gzipped, as one build file loaded when Flags opens and in the background 3.5 s after start-up, so the service worker has it after one visit. Checked in Chromium: after one online visit, a flag round plays with the network off.
* **Recall data:** flag rounds save their answers, but the heatmap and Weak Spots leave them out: recognizing a flag is a different skill from recalling a name.

## Weak Spots (practice)

A round of the 10 countries you're worst at naming, picked from your own saved rounds each time the tab opens.

* **Evidence per country:** every country-name list round (not capitals, flags or routes) with saved answers. An answer counts its time since the previous one (picked from the list, or hinted in an older round: at least 30 s); a country asked for in a given-up round but never named is a miss, counted as 60 s. A country's weakness is its average over all of these.
* **The round:** the 10 weakest; with fewer than 10 countries of evidence, the rest at random, from countries you haven't been asked for yet. The tab says how many came from your profile.
* **Play:** name the 10 countries shown in white on the map, which zooms to fit them (across the 180° line for Pacific islands). The usual hints work. Your answers are saved like any round's, so the list changes as you improve; **New Weak Spots round** picks again.
* Round records now carry the countries asked for (`targets`), so a Weak Spots round's misses count too. Older records are matched to their round by key.
* Weak Spots has no personal bests (it's different every time).

## Daily Challenges

Two dailies, side by side on the setup screen, each with its own seed and its own records:

||Daily Guessing|Daily Pathfinding|
|-|-|-|
|Puzzle|Name every country in one round from an 11-round pool: the 5 continents, the 5 empires and the World (always Countries, even if Capitals is selected)|Connect two countries, 3–7 apart|
|Seed|`guess-deck:<pool size>:<cycle>` (one shuffle per 11-day cycle)|`route:YYYY-MM-DD`|
|Shared as|`geotag - Daily Guessing 2026-10-29`|`geotag - Daily Pathfinding 2026-10-29`|

`dailySeed.ts` hashes `geotag:<seed>` (FNV-1a; the salt is `DAILY\_SALT` and must not change once the game is live) into a Mulberry32 seed. Choices are drawn only from sorted lists, so every browser on the same date gets the same puzzles, whatever its locale or the order the data arrived in. Separate seeds mean a change to how routes are picked never changes the round, and the other way round.

**Dealing Daily Guessing (`dailyGuessing`):** the pool (`GUESSING\_POOL` in `CountryGuesser.tsx`) is dealt like a shuffled deck. The calendar is cut into 11-day cycles (`dayNumber`, a time-zone-free day count); each cycle gets its own shuffle and each day takes the next card, so every round comes up exactly once per cycle. Where one deck meets the next, the last third of the old deck (3 rounds) may not open the new one: any that would are swapped with cards from the middle. So a round never comes back within 3 days (the closest repeat is 4 days apart), and since those swaps never touch a deck's last cards, each day is computed from two shuffles, never a chain back through the calendar. Adding or removing a round reshuffles every future Daily Guessing.

* **One data set:** both dailies are drawn from, and played on, the same bundled `countries.json` as every other round. Nothing is fetched, so every player of the same deployment gets the same puzzles.
* **Local midnight:** both unlock at the player's local midnight (`nextLocalMidnight`, built on `setHours(0, 0, 0, 0)`), not 24 hours after the last play. The setup screen rolls over to the new day on its own: a timer is set for the next midnight, and because timers stall while a device sleeps, the date is checked again whenever the page comes back into view. Pressing Play on a screen left open past midnight shows the new dailies instead of starting yesterday's.
* **Which day a result belongs to:** the puzzle's date, taken when the daily starts. A daily started at 23:58 and finished at 00:03 is yesterday's result, so it can't lock you out of today's puzzle.
* **Records:** the first finished attempt per daily and date goes into the `dailies` store (key `guessing:2026-10-29` or `pathfinding:2026-10-29`, written with `add`, so a second attempt can't replace it); the round is also saved to the profile as usual. **Play again** replays the same puzzle as an ordinary round (not tagged Daily, not shared as Daily).
* **Stats per daily:** played, completed, current streak and best streak. A streak is consecutive calendar days **played**: a day counts once its daily is finished, completed or given up after at least one correct answer (Daily Guessing) or one valid move (Daily Pathfinding). Only a missed day ends a streak, and today still unplayed doesn't (it's open until midnight). Completions are counted separately. Clear history clears these too.
* **An empty give-up doesn't count:** Forfeit or Give Up before naming anything isn't saved as the day's daily at all (`countsAsPlayed` in `db.ts` also filters any saved earlier). The result card says so, the share text isn't titled Daily, and the daily is still open on the setup screen, so a mis-tap on Play can't cost a streak.
* **Upgrading:** version 3 of the database copies every daily already in the profile into the new store: Pathfinding rounds to Daily Pathfinding, the rest to Daily Guessing.
* **Countdown:** once both of today's dailies are played, the note under "Daily Challenges" becomes "Both done. New puzzles in 7 h 12 min", counting down to local midnight (rounded up to the minute, redrawn every 15 s). The cards report what's played to the page (`onStatus`), so it appears when the setup screen reads the profile.

### Daily Archive

**Past puzzles** (under "Daily Challenges") opens every past date's two puzzles, from yesterday back to 1 October 2026 (`ARCHIVE\_START`), grouped by month, newest first. Every puzzle comes from its date's seed, so the archive works offline and needs no storage of its own.

* **Replays don't count:** an archive puzzle plays as an ordinary round, marked **Archive** next to its title. It's never saved as that day's daily, so streaks, played and completed counts never move; the round itself goes to the profile's history (tagged Archive). Shared as `geotag - Daily Guessing 2026-10-28 (archive)`.
* **Same rules:** Daily Guessing as countries, Daily Pathfinding with its guess cap.
* **Played:** a ✓ marks each puzzle already played, live or from the archive, by the same bar as a streak day: at least one country named or one move made. Giving up before either leaves it unticked.
* **Before 30 October 2026** (`DAILY\_RULES\_SINCE`) the dailies were dealt by earlier rules (one shared seed, then a 5-continent pool). The archive deals every date by today's rules, so those dates show puzzles that may differ from what was live; a note in the archive says so.

## Challenge links and QR sharing

Opening `/?route=FRA-CHN` skips the setup screen and starts that route. `RouteChallengeParam` (in `CountryGuesser.tsx`) reads it with `useSearchParams` inside its own `<Suspense>`, so the rest of the page stays in the prerendered HTML.

* **Validation** (`parseRouteParam` in `pathfinding.ts`): any letter case; both codes must be among the 195 countries; not the same country; connected by land; at least one country in between. Anything else falls back to the setup screen with the reason ("XXX isn't a code for one of the game's 195 countries.", "There's no land route from France to United States."). Other query parameters are ignored, and long values are cut short in the message.
* **Same puzzle on every phone:** every copy of the game plays on the same bundled border data.
* **No flash:** a tiny script in `layout.tsx` hides the setup screen before first paint when the URL has `route=` ("Opening your challenge…"), until the game has read the link. If the game's script never loads, the setup screen comes back after 4 s.
* The parameter is removed from the address bar once read, so a reload or "Choose another round" doesn't relaunch it.
* **Share via QR** on every Pathfinding result opens a modal with a QR code for `<this page>?route=START-END`, built from `window.location.origin` so it matches wherever the game is running. Another phone scans it with its camera and lands straight in the route. Challenge results offer **Play this route again**, and share as "Pathfinding Challenge".

  * The modal is a native `<dialog>` opened with `showModal()`: it sits in the browser's top layer, centered in the viewport however far the page is scrolled, keeps keyboard focus inside, closes on Escape, Close or a tap on the backdrop, and returns focus to the button.
  * The code is a single SVG `<path>`, drawn once and never animated. Only the card springs in (transform and opacity), and the backdrop is a flat tint (no blur). The QR library (`qrcode.react` 4.2.0, no dependencies) is in its own chunk, fetched while the result screen is showing.
  * Error correction M with a 2-module quiet zone, dark ink on a flat white face, kept clear of the well's inset shadow so the camera sees crisp modules.

## Share result

Every result screen has a **Share result** button. The text names no countries:

```
geotag - Daily Pathfinding 2026-10-26
🗺️ 5 moves (shortest 4) ⏱️ 01:12
🟩🟩🟨🟩🟩
```

* **Pathfinding:** one square per guess, in order. 🟩 on a shortest route, 🟨 one country out of the way (a shortest route through it is one longer), 🟥 further off. Hints add 💡 n.
* **List rounds:** up to 10 squares, each a tenth of the round's countries in the order named, by pace: 🟩 up to 6 s per country, 🟨 up to 15 s, 🟥 slower, ⬜ not reached. Hints add 💡 n; a forfeit adds 🏳️.
* A round where suggestions showed adds "🔤 with suggestions".

## Haptics and sound

**Sound** (`src/utils/sound.ts`): a short "pop" for a right answer and a low "thud" for a dead end or an error (anything the feedback line shows as a warning or error, and a Game Over), synthesized with the Web Audio API: no audio files, so nothing to download and nothing missing offline. The pop is a 90 ms sine falling from 880 Hz to 440; the thud, a 190 ms triangle falling from 150 Hz to 55 over a sine an octave lower. Both are quiet.

* **The toggle:** a speaker icon at the right of the logo row, before the vibration toggle, wherever Web Audio exists. **Off by default**; turning it on is saved in IndexedDB (`sound` setting) and plays one pop. Browsers only start audio from a tap, so the toggle's tap is what unlocks it; the context is woken again if the browser suspends it.
* **iPhone:** this is the feedback iPhones get, since they have no vibration. The ring/silent switch mutes it, as it does any web page's sound.

**Haptics:** a 30 ms buzz (`navigator.vibrate(\[30])`) on PLAY, on a map tap that shows a country, and when a route is completed. Every call is feature-checked (`typeof navigator.vibrate === "function"`) and wrapped in try/catch, so unsupported browsers do nothing.

* **Where it works:** Chrome-based browsers on Android. No iPhone or iPad browser has the Vibration API, and desktops have nothing to vibrate. Browsers also ignore it until the person has tapped or typed on the page.
* **The toggle** (a phone icon at the right of the logo row) is shown only where it can do something: the API exists and the main pointer is a finger (`(pointer: coarse)`). It's on by default; turning it off is saved in IndexedDB (`haptics` setting), and turning it back on gives one buzz.

## Install and offline

geotag is an installable web app (PWA): Chrome checks it as installable with no errors, and after one online visit it opens and plays with no connection, from the browser or the home screen.

* **Manifest** (`public/manifest.json`): standalone display, starts at `/`, lilac theme color (`#f3efff`, the page's own), square PNG icons in `public/icons/`, cut from the mascot artwork on the splash's gradient: 192 and 512 ("any"), a 512 "maskable" one with the mascot inside the safe zone, a 180 Apple touch icon (iPhones and iPads use it, not the manifest's), and a 64 favicon. The wordmark (`/logo.png`, 511x168) and the full logo (`/assets/logo-full.webp`, 719x900) aren't square, so they can't be app icons.
* **Service worker** (`public/sw.js`), registered after the page loads, production builds only:

  * **Install:** caches the page (the country data is built into it: there's no separate `countries.json` request), every `/\_next/static/` file the page names (scripts and CSS, including chunks only named inside its inline data), the font, the logos and the icons.
  * **Files loaded on demand:** the map, QR and flags chunks aren't named in the page. The page hands the worker its list of loaded files (twice: when the worker is ready and 5 s later), loads the QR chunk 2 s after start-up and the flags 3.5 s after, and the worker caches any build file it serves, so all three are there after the first visit.
  * **Serving:** pages network-first (online players always get the latest build; offline, or after 4 s without an answer, the cached page, for `?route=` links too); `/\_next/static/` cache-first (file names change with their content); other files of ours from the cache, refreshed in the background. Other sites, non-GET and React Server Component requests are left alone.
  * **Updates:** the worker URL carries the build id (`NEXT\_PUBLIC\_BUILD\_ID`, set in `next.config.ts`; pin it with `GEOTAG\_BUILD\_ID`). A new deploy installs a new worker, which caches the new build and deletes the old cache.
* **Checked:** `sw.test.ts` runs the worker against a fake Cache Storage and network; in Chromium, after one visit, stopping the server entirely still lets the game load, draw the map, play a route, open the QR code, and open a `?route=` link.
* **Limits:** the first visit must be online. Service workers need HTTPS (or localhost). On iPhone and iPad, the home-screen app keeps its own storage, apart from Safari's, so a profile built up in Safari doesn't carry over to the installed app.

## Boot-up splash and logo

**Brand files** live in `/public` and ship with the code. Neither is checked for: both are always used.

|File|Used for|
|-|-|
|`public/logo.png` (transparent, 511×168)|Header logo: the "geotag" wordmark alone, straight on the page background with a soft drop-shadow, 48px tall, 56px from 768px wide up. Its alt text ("geotag") names the heading.|
|`public/assets/logo-full.webp` (transparent, 719×900)|Splash logo: the mascot in its ring over the wordmark. A plain image (no video, no frame, no clipping): the card's full width, height following, capped at 16rem (256px), with a soft drop-shadow. Its alt text ("geotag") names the splash dialog.|

Without either file, its spot shows a broken image. Both were cut from the supplied artwork (a JPEG with the peach-lavender gradient baked in): the gradient was modelled and matted out, so the soft shadows stay as transparent shadows, and everything inside the ring was kept opaque. A transparent export from the original source would be cleaner; drop it in at the same paths and sizes. The cutouts are made for light backgrounds: on a dark one, the matted shadows read as a pale glow.

**The sequence:** the splash is in the server HTML, so it covers the game from the first paint. The logo springs in (transform and opacity). PLAY shows a dotted loader and stays locked until the profile database is open and the map chunk has loaded (8 s at most, then it unlocks anyway: the game works without either). PLAY, or Enter/Space, fades the splash out while its content scales to 105% over 500 ms, transform and opacity only, and focus moves to the game's heading.

* **Focus:** the splash is a labelled modal dialog, and focus starts on the dialog itself, not on PLAY. So no focus ring shows at launch; screen readers announce the dialog ("geotag", "Tap to start your adventure"); Enter or Space starts the game; and Tab reaches PLAY, whose ring then shows (keyboard focus only: a tap or click never shows it).
* **Focus trap:** while the splash is up, the game behind it is `inert`: keyboard focus can't reach it and screen readers don't see it.
* **Challenge links skip the splash:** a scanned `?route=` link goes straight into the route (the inline script in `layout.tsx` hides the splash before first paint), so the timer never runs behind it.

## Map taps

The map only answers taps when that can't be used to cheat:

|When|What's tappable|A tap shows|
|-|-|-|
|During any round|Nothing|— (hints are text, and the map never gives an answer away mid-round)|
|After a round (won or forfeited)|Every country on the map|Its name, plus its capital(s) in Capitals mode|

* **One listener:** `SvgMap` takes a single `onClick` on the `<svg>` and reads the tapped element's `data-code`, instead of \~240 handlers. Clickable shapes get `data-clickable` (pointer cursor), and small countries drawn as dots get an invisible tap target three times the dot's size.
* **Phones:** the tooltip stays up after the finger lifts. It closes on the next tap elsewhere (or on the sea), on Escape, or when the round changes. Tapping the map doesn't take focus from the answer field, so the keyboard stays up.
* **60 fps:** the tooltip springs open on transform and opacity only. The tapped country's outline is drawn on its own layer outside the map's SVG filters, so nothing re-runs a filter.
* A note under the map says when it's tappable.
* Map taps are pointer-only. Keyboard and screen-reader players get the same information from the result screen's lists.

## Recall heatmap

Each list round (flag rounds aside) saves every correct answer with the time since the previous one (`answers` in the round record), whether a hint pointed at it (only single-country hints do: a flag's own hints, or Capital City and First Letter in rounds saved before the tallies; flag rounds aren't mapped anyway), and whether it was picked from the suggestion list. The profile maps each country's average onto the world map:

* Bands: under 4 s (green), 4–10 s, 10–20 s, over 20 s (red), blank for never named. A hinted answer (older rounds only, see above) counts as at least 30 s. Picked answers are recognition, not recall, and don't count. Countries and capitals are mapped separately.
* Green to red as asked, with lightness falling at every step, so the order still reads for red-green color-blind players and in grayscale (checked with the dataviz palette validator; it only objects that the ramp isn't one hue, which green to red can't be).
* Each country has a tooltip, and the legend counts each band. The 5 slowest and 5 fastest are listed with their times, so nothing depends on color alone.
* Rounds saved before this phase have no answer data and don't appear.
* "Time since the previous answer" is a proxy: a long gap may mean you were stuck on anything, not on that country. It gets more reliable with more rounds.

## Passport stamps

|Stamp|Earned by|
|-|-|
|Roman Emperor|Completing the Roman Empire (countries or capitals) with no hints and suggestions off|
|Speedrunner|Completing Africa, the Americas, Asia or Europe (more than 30 countries; never Oceania) at under 3 s per country (time ÷ the continent's country count), suggestions off|
|World Traveler|Playing a World round, finished or not|

Earned stamps are thick plastic tokens (a raised rim on a drop shadow, a pressed-in face, embossed lettering); unearned ones are the deep empty impression the token will sit in. All depth is `box-shadow` and `text-shadow`, with no images. The only animation is the press-in when the tab opens (transform and opacity). Stamps count every saved round, whatever the profile filter, and are dated from the first round that earned them.

## Profile \& Stats

Each finished or forfeited round is saved once, after the Timer reports the final time: mode, round, result, time, guesses made, countries named, hints used, moves and shortest route (Pathfinding), whether suggestions showed, and a timestamp. The tab shows:

* **Tiles:** games played, rounds won (with win rate), total time played.
* **Average winning time by mode:** one bar per mode, with seconds per country (or moves over the shortest route) underneath. Forfeits are left out of the averages.
* **Personal bests:** fastest win for each continent, empire and World. Routes are random, so they have none.
* **Recent rounds:** the latest 20, tagged Won/Forfeited, Daily, Best and Suggestions. Capitals rounds keep their own personal bests ("Oceania capitals").
* **Filter:** all rounds, without suggestions, or with suggestions.

## Hints (2 per round, given in order)

List rounds (continents, empires, World, Weak Spots, Daily Guessing) get two text hints. Neither is about one country: both are tallies over every answer still missing, recounted after each correct answer, so they shrink as you go. Nothing is marked on the map.

1. **Starting Letters:** how many missing countries start with each letter, most common first, ties A to Z ("Remaining starting letters: M (3), C (1), T (1)"). Accents fold into their letter: Türkiye counts under T.
2. **Name Lengths:** how many missing countries have each name length, shortest first ("Remaining name lengths: 4 letters (1), 8 letters (2)"). Only letters count: Guinea-Bissau has 12, Sri Lanka 8.

Each count is a small clay chip; the chip whose count just changed springs back in, and a letter or length drops out when its last country is named. Screen readers hear a tally once, when it's given, not on every change (the answer feedback already speaks then). Both count **the names this game shows**: Ivory Coast is an I, Eswatini an E, Myanmar an M, Timor-Leste a T, DR Congo a D with 7 letters. In Capitals mode they count each missing country's displayed capital instead (Sri Lanka's is Sri Jayawardenepura Kotte, not Colombo). The tallies never mark an answer as hinted: they describe every missing country at once, not one, so answers keep their raw recall time for the heatmap and Weak Spots whether a tally is open or not. The result line reports hints used. Flags keep their own per-flag hints (see Vexillology Mode) and Pathfinding its two map hints (see Fog of war).

## Map

* **Data:** Natural Earth 1:50m. The usual 1:110m file has no shape at all for 29 sovereign states (8 of Oceania's 14). At 1:50m only Tuvalu is missing.
* **Framing:** every round has its own frame and center longitude. Rome is centered on the Mediterranean, the Mughal Empire on South Asia, the Ottomans run from the Balkans to the Horn of Africa, and the Soviet Union from the Baltic to the Bering Strait. The British Empire and World Mode show the whole world. Oceania and the Soviet Union stay in one piece across the 180° meridian.
* **Frames are set per round, not computed:** a box computed from country centers would follow Russia's center point into Siberia for the Ottoman round, and the British Empire spans every longitude. A test checks that every country in all 11 rounds is on screen.
* **Small countries:** anything too small to see also gets a dot that fills and pulses like an outline. At continent zoom that means under 40 square units. Zoomed out, the threshold and dot shrink: World Mode gets 40 dots instead of 78, and the Netherlands, Belgium and Switzerland show as shapes.
* **Clay depth:** SVG filters (outer drop shadow plus light top-left and dark bottom-right inner edges), one per layer rather than per path. CSS `drop-shadow()` can't draw inset edges.
* **Performance:** a newly named country pops on an unfiltered layer, then joins the clay layer when its spring settles. Popping inside a filtered layer made Chromium re-run the filter every frame, measured at 12 fps instead of 60.
* **Loading:** the map code and data are a separate 62 KB (gzipped) chunk, fetched while the player is on the setup screen.

### Why the live rules exist (measured on all 195 countries, each typed letter by letter in its own continent)

|Policy|Correct spelling: wrong country credited|Correct spelling: cut off mid-word|One random typo (3,900 samples): wrong country credited|
|-|-|-|-|
|Accept any match on every keystroke|7 (Nigeria→Niger, Ukraine→UK, Zimbabwe→Zambia, Turkmenistan→Türkiye…)|81%|3.3%|
|`liveMatch`|0|0|0|

With `liveMatch`, 191 of 195 correctly spelled names land on their last keystroke with no Enter. The other 4 (Niger, Guinea, Congo, Dominica) need Enter while their longer neighbour is unnamed. Each keystroke takes 0.5 ms median to process in the browser (p95 3.1 ms).

## Typing on a phone

When the answer field has focus and the on-screen keyboard is up, the round's essentials are pinned into the space above the keyboard: a one-line header (title, counter, timer), the map, which takes all the height that's left and scales down to fit, and the field with Check beside it and the feedback line under it. Hints, the route list, the map key and Give Up come back when the keyboard closes. Suggestions open upward, over the map. Nothing scrolls.

* **Why not just `100dvh`:** the dynamic viewport units follow the browser's toolbars, not the keyboard. On iPhone the keyboard slides over the page and the layout viewport keeps its height, so `100dvh` doesn't change. `100dvh` is still the fallback (and the page's `min-height`).
* **Android:** `interactiveWidget: "resizes-content"` (in `layout.tsx`) makes Chrome shrink the layout, and `100dvh`, for the keyboard.
* **iPhone (and everything else):** `src/utils/viewport.ts` watches `window.visualViewport` (the area actually visible above the keyboard) and sets `--vv-height`, `--vv-top` (iOS pans the page under the keyboard) and `data-keyboard` on `<html>`, at most once per frame. The keyboard counts as up when the visible area is 150 px or more shorter than the tallest it has been at this width (toolbars move it less); rotating starts over, and pinch-zoom isn't mistaken for it.
* The pinned layout is CSS only (`html\[data-keyboard] .game:has(.answer-card input:focus)`, under 1024px with a touch pointer), so it ends the moment the keyboard closes, even if the field keeps focus (Android's back button).

## Layout

* **Splash:** no card: the logo, PLAY, tagline and loader float centered on the full-screen peach-lavender gradient. The tagline is in full ink and pulses only to 75% opacity, so it stays above 4.5:1 contrast on the bare gradient at its faintest.
* **Header:** the logo on the left; **Profile \& Stats** and the vibration toggle on the right, on every screen. Profile \& Stats is an icon on phones and a labelled pill from 600px. It isn't shown during a round: the profile's heatmap would give answers away.
* **Phones and tablets (under 1024px):** one column, up to 760px wide. During a round the map comes straight after the header, above the answer field (grid `order` only: the markup and the reading order don't change).
* **Desktop (1024px and up):** up to 1200px wide, in two columns, set in CSS by the screen (`.game-shell\[data-screen="setup" | "round"]`, as `.game`'s grid items; no markup moves):

  * **Setup:** the two Daily Challenges stacked on the left (they stay in view on screens at least 860px tall), the mode picker on the right, where the tile grids widen to fill it. On tablets (720–1023px) the two dailies sit side by side.
  * **Rounds:** the answer field, hints, result and lists on the left; the map on the right, staying in view as the left column scrolls (its height capped to fit the screen). Pass and play's hand-over card is centered across both.

## Clay theme

* **Depth:** every surface uses the same 4-layer recipe: a tight contact shadow, a soft drop shadow, a light top-left inset, and a dark bottom-right inset. Pressed states flip the two insets. Recipes keep the same layer order, so states interpolate smoothly.
* **Motion:** springs are real damped-oscillator curves sampled into CSS `linear()` (`--spring-snappy`, `--spring-bouncy`, `--spring-gentle`). Browsers without `linear()` get a single-overshoot `cubic-bezier`. `prefers-reduced-motion` swaps all springs for a short fade and turns off the input press.
* **Color:** chip and continent-button fills use atlas pastels per continent. All text is at least 5:1 contrast.
* **Light only:** `color-scheme: light`. There is no dark theme.

## Matching rules (`matchCountry`)

1. **Normalize**: lowercase, strip accents, `\&`→`and`, `St`→`Saint`, drop apostrophes/punctuation and a leading "the".
2. **Exact hit wins**: if the normalized input equals any name or alias, that country is returned. "Niger" never becomes "Nigeria".
3. **Fuzzy fallback** (Levenshtein via `fastest-levenshtein`), with tolerance scaled to name length:
≤3 chars: exact only · 4–5: 1 edit · 6–9: 2 edits · 10+: 3 edits.
A single swap of two adjacent letters ("Mlai") counts as 1 edit, not Levenshtein's 2. Without this, "mlai" scored as close to Malawi as to Mali, and the wrong country won.
4. **Ambiguity guard**: if two countries tie for closest, nothing is accepted. "Irak" is 1 edit from both Iran and Iraq, so the player is asked to type more.
5. **Scope** (for continent rounds): matching always runs against the whole world first. Scope only breaks ties, and an exact out-of-scope answer returns `out\_of\_scope`. This stops "Austria" from being auto-corrected to "Australia" in an Oceania round.

Result statuses: `match` · `ambiguous` · `out\_of\_scope` · `no\_match` (`empty` | `too\_short` | `not\_found`).

### Measured accuracy

|Input|Variants|Credited to the wrong country|
|-|-|-|
|One typo (delete, insert, substitute, or swap one letter)|93,122|0|
|Two random typos|\~28,800 (sampled)|\~0.7%|

Two-typo misses are mostly inputs that genuinely sit closer to another name ("austaia" is 1 edit from Austria, 2 from Australia). No edit-distance metric can recover those.

## Known limits

* A round counts as "with suggestions" once the list has shown any answer, even if none was picked. Such rounds can't earn Roman Emperor or Speedrunner, so switch Suggestions off before typing.
* A QR code made on `localhost` points at the scanning phone's own localhost, so it can't be opened elsewhere; the modal says so. Test phone-to-phone from the deployed site, or open the dev server by its network address (e.g. `http://192.168.1.20:3000`) with both phones on the same Wi-Fi. Vercel preview deployments may ask the scanning phone to log in if Deployment Protection is on; production links don't.
* The profile lives in one browser. It doesn't sync between devices, and clearing site data erases it. Safari deletes script-written storage, IndexedDB included, for sites not visited in 7 days, unless the site is added to the Home Screen.
* "Average time per mode" mixes round sizes: a Continents average blends Oceania (14) and Africa (54). Seconds per country and personal bests are the comparable numbers.
* Suggestions don't narrow the answers down, but they still jog your memory ("b" lists every B country), so assisted times aren't comparable with unassisted ones. Use the filter.
* The dailies are identical for everyone running the same deployment: they use the bundled `countries.json`, so refreshing it (`npm run snapshot`) and redeploying can change future dailies. Do that between days, not mid-day.
* Daily Guessing's rounds vary a lot in size: the Mughal day is 4 countries (seconds), the World day is 195 (often 20+ minutes). Each comes up once every 11 days.
* Streaks count days played, so an instant Give Up keeps one alive. Completed is the number that shows skill.
* Within a cycle, a player who has seen ten of the eleven rounds knows the eleventh. It doesn't make naming the countries any easier.
* "Same for everyone" means the same local date. Players east of you get the next puzzle first and can share it before you've played.
* Disputed capitals follow the data: Israel's is Jerusalem, and Palestine's accepts Ramallah or East Jerusalem.
* The brand name lives in one constant, `BRAND\_NAME` in `src/utils/share.ts`: the page `<title>`, the header and the share text all read it. The IndexedDB database keeps its original internal name (`country-recall`) so existing saved profiles aren't lost; players never see it.
* Pathfinding treats each country as one place, so routes can cross water inside a country: Thailand → Malaysia → Indonesia → Papua New Guinea is legal because Malaysia borders Thailand on the mainland and Indonesia on Borneo. Spain–Morocco counts through Ceuta and Melilla.
* The pathfinding map is framed around one shortest route; a long detour can wander past its edges.
* The fog hides borders, not coastlines: an island country (the UK, Sri Lanka) is still recognizable by its shape.
* Vexillology Mode is visual: screen readers hear "The flag to name" (never the answer), so it can't be played without sight. Every other mode can.
* The flags chunk (395 KB gzipped) is the largest file in the app, and the first visit downloads it in the background even if Flags is never played; that's the price of flags offline. The full-color set without emblem detail would be 57 KB.
* Afghanistan shows the black, red and green tricolor, as flag-icons does, not the Taliban's white flag. Disputed flags follow the library; change `scripts/build-flags.mjs` to override one.
* The Daily Archive's puzzles before 30 October 2026 are re-dealt by today's rules (see "Daily Archive").
* The guess cap's margin (shortest route plus 4) is a judgment call, not tuned with players. Change `DAILY\_GUESS\_MARGIN` to adjust it.
* The Pathfinding explainer is saved per browser: a player on a second device sees it once there too.
* Weak Spots only knows what's been saved in this browser, and only from rounds played since answers were recorded.
* The empire lists apply one rule, but history has edge cases: see "Empire lists" for the calls made and the borderline ones.
* The pinned keyboard layout was checked in desktop Chromium with phone emulation and a shrunken viewport (how Android behaves). The iPhone path (`--vv-top` panning) is unit-tested but not yet checked on a real iPhone.
* A phone with a hardware keyboard attached shows no on-screen keyboard, so the page keeps its normal layout; that's intended.
* The Mughal round has only 4 countries, so it lasts seconds.
* Borders only link sovereign states: Morocco–Western Sahara and Brazil–French Guiana don't count in Pathfinding.
* Reveal Adjacent and Reveal All are visual. Screen-reader users get their text, but not the outlines.
* A typo'd answer needs a 0.7 s pause (or Enter) before the next country. If the player types straight on, the two words run together in the field.
* The 700 ms pause is tuned by feel, not measured with players.
* Continents follow the dataset's regions: "Americas" is one round (35 countries), and borderline cases follow the data (Türkiye, Armenia, Georgia and Azerbaijan are Asia; Russia and Cyprus are Europe).
* The swap rule covers exactly one swap. A swap plus another typo still costs 3 edits.
* Taiwan and Kosovo are excluded by the UN-based definition. Add their codes to `UN\_OBSERVER\_STATES` in `loadCountries.ts` to include them.
* The dataset marks Vatican City `unMember: true` (it is a UN observer). The 195 count is still correct because Vatican City is included either way. Don't rely on `unMember` alone elsewhere.
* The bundled `countries.json` was generated from the mledoze/countries dataset, which uses the same field structure REST Countries serves. `npm run snapshot` replaces it with a fresh pull from REST Countries; that's a maintenance step run on your machine, never by the app.
* **No network at runtime:** the page is fully static (built once, no revalidation), and no app code calls `fetch` or any other network API. A test (`loadCountries.test.ts`, "offline-first guard") fails if one is added. The only `fetch` calls are the service worker's, which only ever fetch the game's own files to cache them. After one online visit the game opens with no connection (see "Install and offline").

## Empire lists

Every list follows one rule, shown on the Empires tab (`EMPIRE\_RULE`):

> \*\*Any part of today's country was directly governed by the empire during its era\*\* (the era on its tile). Annexed or run by its own officials counts. Vassals, protected states with their own rulers, and wartime occupations don't.

"Any part" is what lets the US count for the British Empire (the Thirteen Colonies), and it also brings in places that surprise: China (Hong Kong), Spain (Menorca), Germany (Heligoland). Where only part of a country qualified, `historical\_empire\_notes.json` says which part and when, and the game shows it on the country's chip and its map tooltip after the round.

Changes from the original lists:

|Empire|Removed|Added|
|-|-|-|
|Roman (45)|Moldova (outside Dacia)|Ukraine (Tyras, in Moesia Inferior from AD 56), Armenia (Trajan's province, 114–117), Saudi Arabia (Hegra, Arabia Petraea)|
|Ottoman (37)|UAE, Oman, Bahrain (never ruled), Kuwait (nominal suzerainty only)|Croatia (Slavonia), Slovakia (Uyvar province, 1663–1685), Iran (Tabriz province, 1585–1603)|
|Soviet (17)||Poland (Białystok, annexed to the Byelorussian SSR in 1939), Finland (Porkkala, a Soviet-run naval base, 1944–1956)|
|British (71)|Kuwait, Bahrain, Qatar, UAE, Maldives, Tonga, Brunei (protected states with their own rulers); Egypt, Jordan, Iraq (their own governments under a protectorate or mandate)|United States, Mauritius, Seychelles, China, Spain, Germany, France (Dunkirk, 1658–1662), Morocco (Tangier, 1661–1684), Indonesia (Bencoolen), Senegal (Senegambia), Guinea (Îles de Los), Suriname, Honduras (Bay Islands), Colombia (Providence Island), Nauru|
|Mughal (4)|||

Oman stays British: the Khuriya Muriya Islands were part of Aden Colony from 1854 to 1967.

Borderline calls, left as they are; edit the JSON files to change them:

* **Ottoman Djibouti** is kept as provided: the Habesh province's coast is usually drawn to include Tadjoura, but direct Ottoman rule there is thinly documented.
* **Ottoman Chad** is not added: Ottoman troops held Bardaï in the Tibesti from 1908 to 1913, but it's unclear it was ever administered.
* **Roman Georgia** is not added: Roman forts on the coast (Apsaros, Phasis) were garrisons among client kingdoms, not a province.
* **British Iraq** is out: Britain ran Mesopotamia directly from 1914 to 1921, but as a wartime occupation, then through a mandate with its own king. Palestine stays: its mandate was run by a British High Commissioner.
* **Mandates run by the Dominions** (Samoa by New Zealand, Nauru by Australia, Namibia by South Africa) count as British Empire rule.

