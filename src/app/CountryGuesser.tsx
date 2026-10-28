"use client";

import { useSearchParams } from "next/navigation";
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import DailyCard from "@/components/game/DailyCard";
import HintPanel, { initialsOf, MAX_HINTS, pickHintTarget } from "@/components/game/HintPanel";
import MapTooltip from "@/components/game/MapTooltip";
import ProfilePanel from "@/components/game/ProfilePanel";
import ShareResult from "@/components/game/ShareResult";
import Timer, { formatElapsed } from "@/components/game/Timer";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import ClayInput, { type ClayInputOption } from "@/components/ui/ClayInput";
import type { EmpireKey, EmpireRound } from "@/data/loadCountries";
import SplashScreen, { SPLASH_EXIT_MS } from "@/components/game/SplashScreen";
import { getSetting, initDb, listPartyResults, savePartyResult, saveRound, setSetting, type PartyResult, type RoundRecord } from "@/utils/db";
import PartyBoard from "@/components/game/PartyBoard";
import { downloadBlob, renderScoreCard, scoreCardFileName } from "@/utils/scoreCard";
import { dailyChallenge, dateKey } from "@/utils/dailySeed";
import {
  answerForInput,
  answerLabel,
  buildIndex,
  liveMatch,
  matchCountry,
  normalize,
  suggestCountries,
  type AnswerKind,
  type Country,
} from "@/utils/fuzzyMatch";
import {
  applyStep,
  buildBorderGraph,
  currentCountry,
  MAX_PAR,
  MIN_PAR,
  parseRouteParam,
  pickRoute,
  reachesEnd,
  routeParam,
  type RoutePuzzle,
} from "@/utils/pathfinding";
import { BRAND_NAME, buildShareText, paceGrid, routeGrid } from "@/utils/share";
import { hapticsUseful, vibrate } from "@/utils/haptics";

// The map (d3-geo + outline data, ~60 KB gzipped) loads in its own chunk, fetched
// while the player is still on the setup screen.
const loadSvgMap = () => import("@/components/game/SvgMap");
const SvgMap = lazy(loadSvgMap);
/** What the splash screen's PLAY waits for: the profile database open, the map data loaded. */
const prepareGame = () => Promise.allSettled([loadSvgMap(), initDb()]);
/** The header logo: a transparent PNG in /public. */
export const LOGO_SRC = "/logo.png";

// The QR modal (and the QR library inside it) loads only after a route ends.
const loadQrShareModal = () => import("@/components/game/QrShareModal");
const QrShareModal = lazy(loadQrShareModal);
/** The QR chunk is fetched this long after the page loads, so it's there offline. */
const QR_PRELOAD_MS = 2000;

/* ------------------------------------------------------------------ */
/* Rounds                                                              */
/* ------------------------------------------------------------------ */

export const CONTINENTS = ["Africa", "Americas", "Asia", "Europe", "Oceania"] as const;
export type Continent = (typeof CONTINENTS)[number];
export type GameMode = "continent" | "historical" | "world" | "pathfinding";
/** One playable round: a continent, an empire, or the whole world. Also keys the map framing. */
export type RoundKey = Continent | EmpireKey | "World";

type Round = {
  mode: GameMode;
  key: RoundKey;
  /** Heading while playing: "Africa", "Roman Empire", "World". */
  title: string;
  targetCodes: string[];
  /** Color theme (continent or empire). null: each country is colored by its continent. */
  theme: string | null;
  /** Result line opener: "Every country in Africa". */
  everyPhrase: string;
  /** The same in Capitals mode: "Every capital in Africa". */
  capitalsPhrase: string;
  /** Leads the share text's stats line. */
  emoji: string;
  /** Why a recognized country doesn't count, or null if every country counts. */
  outOfScope: ((countryName: string) => string) | null;
};

/** Tabs on the setup screen: one per game mode, plus the player's profile. */
type SetupTab = GameMode | "profile";

const SETUP_TABS: { tab: SetupTab; label: string }[] = [
  { tab: "continent", label: "Continents" },
  { tab: "historical", label: "Empires" },
  { tab: "world", label: "World" },
  { tab: "pathfinding", label: "Pathfinding" },
  { tab: "profile", label: "Profile & Stats" },
];

const CONTINENT_EMOJI: Record<Continent, string> = {
  Africa: "🌍",
  Americas: "🌎",
  Asia: "🌏",
  Europe: "🌍",
  Oceania: "🌏",
};

const NOTHING_NAMED: ReadonlySet<string> = new Set();
const NO_OPTIONS: ClayInputOption[] = [];
/** IndexedDB settings keys: the autocomplete toggle, and Countries/Capitals on the setup screen. */
const SUGGESTIONS_SETTING = "suggestions";
const ANSWER_SETTING = "answer";
const HAPTICS_SETTING = "haptics";

/* ------------------------------------------------------------------ */
/* Game session state                                                  */
/* ------------------------------------------------------------------ */

export type GameStatus = "setup" | "playing" | "won" | "forfeited";
export type Guess = {
  country: Country;
  typed: string;
  distance: number;
  /** The answer shown for it: the country's name, or the capital in Capitals mode ("Cape Town"). */
  label?: string;
  /** ms after the round started; drives the share text's pace grid and the recall heatmap. */
  at?: number;
  /** A hint pointed at this country before it was named. */
  hinted?: boolean;
  /** Chosen from the suggestion list rather than typed. */
  picked?: boolean;
};

export type Session = {
  mode: GameMode;
  roundKey: RoundKey | null;
  /** cca3 codes of every country to name this round */
  targetCodes: string[];
  guesses: Guess[];
  status: GameStatus;
  /** Increments on each start; keys the Timer and map so every round starts fresh. */
  round: number;
  /** Final time, reported by the Timer when it stops. */
  elapsedMs: number | null;
  hintsUsed: number;
  /** Country each hint stage is about: [stage 1 (borders), stage 2 (outline)]. */
  hintTargets: [string | null, string | null];
  /** Pathfinding only: the start/end pair. `guesses` then holds the route between them. */
  route: RoutePuzzle | null;
  /** Pathfinding only: every valid step taken, including steps back. */
  moves: number;
  /** Every answer committed: accepted ones, plus submissions that were rejected. */
  attempts: number;
  /** The autocomplete list showed answers at some point this round. */
  assisted: boolean;
  /** What the player names: countries, or their capitals. Pathfinding is always countries. */
  answer: AnswerKind;
  /** The Daily Challenge's date (YYYY-MM-DD), or null for any other round. */
  daily: string | null;
  /** Pathfinding only: every country stepped to, in order, steps back included. */
  path: string[];
  /** Pathfinding only: the route came from a challenge link (?route=FRA-CHN). */
  challenge: boolean;
};

export type SessionAction =
  | {
      type: "start";
      mode: GameMode;
      roundKey: RoundKey;
      targetCodes: string[];
      answer?: AnswerKind;
      daily?: string | null;
    }
  | { type: "guess"; guess: Guess }
  | { type: "forfeit" }
  | { type: "timerStopped"; elapsedMs: number }
  | { type: "hint"; target: string | null }
  | {
      type: "startRoute";
      puzzle: RoutePuzzle;
      daily?: string | null;
      challenge?: boolean;
    }
  /** A step to a country bordering the current one. `complete`: the route now touches the end. */
  | { type: "step"; guess: Guess; complete: boolean }
  /** A submitted answer that didn't count (unrecognized, ambiguous, out of scope, already named). */
  | { type: "miss" }
  /** Suggestions were showing during this round. */
  | { type: "assist" }
  | { type: "reset" };

export const initialSession: Session = {
  mode: "continent",
  roundKey: null,
  targetCodes: [],
  guesses: [],
  status: "setup",
  round: 0,
  elapsedMs: null,
  hintsUsed: 0,
  hintTargets: [null, null],
  route: null,
  moves: 0,
  attempts: 0,
  assisted: false,
  answer: "countries",
  daily: null,
  path: [],
  challenge: false,
};

export function sessionReducer(state: Session, action: SessionAction): Session {
  switch (action.type) {
    case "start":
      return {
        ...initialSession,
        mode: action.mode,
        roundKey: action.roundKey,
        targetCodes: action.targetCodes,
        answer: action.answer ?? "countries",
        daily: action.daily ?? null,
        status: "playing",
        round: state.round + 1,
      };
    case "guess": {
      const { code } = action.guess.country;
      if (state.status !== "playing") return state;
      if (!state.targetCodes.includes(code)) return state;
      if (state.guesses.some((g) => g.country.code === code)) return state;
      const guesses = [...state.guesses, action.guess];
      return {
        ...state,
        guesses,
        attempts: state.attempts + 1,
        status: guesses.length === state.targetCodes.length ? "won" : "playing",
      };
    }
    case "forfeit":
      return state.status === "playing" ? { ...state, status: "forfeited" } : state;
    case "timerStopped":
      return { ...state, elapsedMs: action.elapsedMs };
    case "hint": {
      if (state.status !== "playing" || state.hintsUsed >= MAX_HINTS) return state;
      const stage = state.hintsUsed + 1;
      const hintTargets: Session["hintTargets"] = [...state.hintTargets];
      if (stage <= 2) hintTargets[stage - 1] = action.target;
      return { ...state, hintsUsed: stage, hintTargets };
    }
    case "startRoute":
      return {
        ...initialSession,
        mode: "pathfinding",
        route: action.puzzle,
        daily: action.daily ?? null,
        challenge: action.challenge ?? false,
        status: "playing",
        round: state.round + 1,
      };
    case "step": {
      if (state.status !== "playing" || !state.route) return state;
      const code = action.guess.country.code;
      const codes = applyStep(
        state.route,
        state.guesses.map((g) => g.country.code),
        code,
      );
      const guesses = codes.map((c) => state.guesses.find((g) => g.country.code === c) ?? action.guess);
      return {
        ...state,
        guesses,
        moves: state.moves + (code === state.route.end ? 0 : 1),
        path: [...state.path, code],
        attempts: state.attempts + 1,
        status: action.complete ? "won" : "playing",
      };
    }
    case "miss":
      return state.status === "playing" ? { ...state, attempts: state.attempts + 1 } : state;
    case "assist":
      return state.status === "playing" && !state.assisted ? { ...state, assisted: true } : state;
    case "reset":
      return { ...initialSession, mode: state.mode, round: state.round };
  }
}

/**
 * Reads a challenge link's `?route=` (e.g. scanned from a "Share via QR" code) and hands it to the game once.
 * Kept in its own component under a Suspense boundary: useSearchParams makes everything up
 * to the nearest boundary render on the client only, and the rest of the page should stay
 * in the prerendered HTML.
 */
/** A phone with vibration marks; struck through when vibration is off. Decorative: the button carries the name. */
function VibrationIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" className="haptics-toggle__icon">
      <rect x="8" y="4" width="8" height="16" rx="2.2" />
      <path d="M11 17h2" />
      {off ? (
        <path d="M4 4l16 16" className="haptics-toggle__slash" />
      ) : (
        <path d="M4.5 9v6M2 10.5v3M19.5 9v6M22 10.5v3" />
      )}
    </svg>
  );
}

function RouteChallengeParam({ onRoute }: { onRoute: (raw: string) => void }) {
  const raw = useSearchParams()?.get("route") ?? null;
  const handled = useRef<string | null>(null);
  const onRouteRef = useRef(onRoute);
  useEffect(() => {
    onRouteRef.current = onRoute;
  });
  useEffect(() => {
    if (raw === null || handled.current === raw) return;
    handled.current = raw;
    onRouteRef.current(raw);
  }, [raw]);
  return null;
}

/** How long typing must pause before a typo-corrected answer is accepted. Tuned by feel, not measured. */
export const TYPO_ACCEPT_DELAY_MS = 700;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Feedback = { tone: "ok" | "warn" | "error" | "hint"; text: string } | null;

/**
 * Pass-and-play (Party Mode): players take turns on one route, one device. Player 1's
 * round is the one that was just played; each later player gets a hand-over screen, and
 * the clock starts at 00:00 when they tap Start.
 */
type Party = {
  id: string;
  /** The route, "FRA-CHN". */
  route: string;
  /** Whose turn it is (or was, on the result screen). */
  player: number;
  /** The session round being played as this player's turn; null while handing over. */
  round: number | null;
  /** Showing the hand-over screen. */
  handoff: boolean;
};

const newPartyId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
type Props = {
  /** The 195 sovereign states, from the bundled countries.json (the app's only country data). */
  countries: Country[];
  empires: EmpireRound[];
  /** The boot-up splash (on by default). Challenge links skip it either way. */
  showSplash?: boolean;
};

export default function CountryGuesser({
  countries,
  empires,
  showSplash = true,
}: Props) {
  // Boot-up splash: "open" (the game behind is inert), "leaving" (exit playing, game live), "gone".
  const [splash, setSplash] = useState<"open" | "leaving" | "gone">(showSplash ? "open" : "gone");
  // Haptics: a short buzz on PLAY, on a map tap that shows something, and on finishing a route.
  // On by default; the header toggle (shown only where vibration can work) turns it off for good.
  const [hapticsOn, setHapticsOn] = useState(true);
  const [hapticsOffered, setHapticsOffered] = useState(false);
  const hapticsRef = useRef(true); // read by stable callbacks
  const buzz = useCallback(() => {
    if (hapticsRef.current) vibrate();
  }, []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (splash === "leaving") {
      // The game is live again: put keyboard and screen-reader focus at its top.
      titleRef.current?.focus({ preventScroll: true });
      const timer = setTimeout(() => setSplash("gone"), SPLASH_EXIT_MS);
      return () => clearTimeout(timer);
    }
  }, [splash]);
  const countryIndex = useMemo(() => buildIndex(countries), [countries]);
  const capitalIndex = useMemo(() => buildIndex(countries, "capitals"), [countries]);
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  // The matcher for this round: country names, or capitals in Capitals mode.
  const isCapitals = session.answer === "capitals";
  const index = isCapitals ? capitalIndex : countryIndex;
  // Setup screen's Countries/Capitals modifier for list rounds; kept in IndexedDB.
  const [answerSetting, setAnswerSetting] = useState<AnswerKind>("countries");
  // Today's date, read after hydration (the server can't know the player's time zone).
  const [today, setToday] = useState<string | null>(null);
  // When the current round started, for each answer's `at`.
  const startedAt = useRef(0);
  // Why a challenge link couldn't be played; shown on the setup screen.
  const [challengeNotice, setChallengeNotice] = useState<string | null>(null);
  // Which tab of the setup screen is showing; starts on the mode of the last round played.
  const [setupMode, setSetupMode] = useState<SetupTab>("continent");
  // Autocomplete list under the answer field. On by default; the choice is kept in IndexedDB.
  const [suggestionsOn, setSuggestionsOn] = useState(true);
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  // Bumped on every message so it re-mounts and replays its spring.
  const [attempt, setAttempt] = useState(0);
  // Bumped on every accepted answer to replay the input's press-and-rebound spring.
  const [presses, setPresses] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultHeadingRef = useRef<HTMLHeadingElement>(null);
  const handoffHeadingRef = useRef<HTMLHeadingElement>(null);
  // Party Mode: the session, and its results (saved in IndexedDB, mirrored here).
  const [party, setParty] = useState<Party | null>(null);
  const [partyResults, setPartyResults] = useState<PartyResult[]>([]);
  // During a party the shortest route stays hidden, unless revealed for this round.
  const [revealedRound, setRevealedRound] = useState<number | null>(null);
  // Save Score: idle, drawing the card, or how the last attempt went.
  const [scoreCard, setScoreCard] = useState<{ round: number; state: "saving" | "saved" | "failed" } | null>(null);

  const rounds = useMemo(() => {
    const all = new Map<RoundKey, Round>();
    for (const continent of CONTINENTS) {
      all.set(continent, {
        mode: "continent",
        key: continent,
        title: continent,
        targetCodes: countries.filter((c) => c.region === continent).map((c) => c.code),
        theme: continent,
        everyPhrase: `Every country in ${continent}`,
        capitalsPhrase: `Every capital in ${continent}`,
        emoji: CONTINENT_EMOJI[continent],
        outOfScope: (name) => `${name} isn't in ${continent}.`,
      });
    }
    for (const empire of empires) {
      all.set(empire.key, {
        mode: "historical",
        key: empire.key,
        title: empire.title,
        targetCodes: empire.codes,
        theme: empire.key,
        everyPhrase: `Every modern country on the ${empire.title} list`,
        capitalsPhrase: `Every capital on the ${empire.title} list`,
        emoji: "🏛️",
        outOfScope: (name) => `${name} isn't on the ${empire.title} list.`,
      });
    }
    all.set("World", {
      mode: "world",
      key: "World",
      title: "World",
      targetCodes: countries.map((c) => c.code),
      theme: null,
      everyPhrase: "Every country in the world",
      capitalsPhrase: "Every capital in the world",
      emoji: "🌐",
      outOfScope: null,
    });
    return all;
  }, [countries, empires]);

  const regions = useMemo(() => Object.fromEntries(countries.map((c) => [c.code, c.region])), [countries]);
  const graph = useMemo(() => buildBorderGraph(countries), [countries]);
  const allCodes = useMemo(() => countries.map((c) => c.code), [countries]);
  const playable = useMemo(() => new Set(allCodes), [allCodes]);

  const { status, guesses } = session;
  const current = session.roundKey ? rounds.get(session.roundKey) : undefined;
  const isPlaying = status === "playing";
  const isOver = status === "won" || status === "forfeited";

  const targetSet = useMemo(() => new Set(session.targetCodes), [session.targetCodes]);
  const namedSet = useMemo(() => new Set(guesses.map((g) => g.country.code)), [guesses]);

  // Pathfinding: valid answers are the countries bordering where the player stands.
  const route = session.route;
  const isRoute = session.mode === "pathfinding" && route !== null;
  const here = route ? currentCountry(route, guesses.map((g) => g.country.code)) : null;
  const hereName = here ? index.byCode.get(here)!.name : "";
  const routeScope = useMemo(() => (here ? (graph.get(here) ?? new Set<string>()) : new Set<string>()), [graph, here]);
  // What the shared matcher should accept right now. Route steps may revisit countries, so nothing counts as "named".
  const scope = isRoute ? routeScope : targetSet;
  const alreadyNamed = isRoute ? NOTHING_NAMED : namedSet;
  const nameOf = (code: string) => index.byCode.get(code)!.name;
  const missing = useMemo(
    () =>
      session.targetCodes
        .filter((code) => !namedSet.has(code))
        .map((code) => index.byCode.get(code)!)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [session.targetCodes, namedSet, index],
  );

  // Fetch the map chunk early so it is ready when the round starts.
  useEffect(() => {
    void loadSvgMap();
  }, []);

  useEffect(() => {
    let live = true;
    setToday(dateKey());
    void getSetting(SUGGESTIONS_SETTING, true).then((on) => {
      if (live && !on) setSuggestionsOn(false);
    });
    void getSetting<AnswerKind>(ANSWER_SETTING, "countries").then((answer) => {
      if (live && answer === "capitals") setAnswerSetting("capitals");
    });
    setHapticsOffered(hapticsUseful());
    void getSetting(HAPTICS_SETTING, true).then((on) => {
      if (live && !on) {
        hapticsRef.current = false;
        setHapticsOn(false);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  function chooseAnswer(answer: AnswerKind) {
    setAnswerSetting(answer);
    void setSetting(ANSWER_SETTING, answer);
  }

  const daily = useMemo(() => (today ? dailyChallenge(today, graph, CONTINENTS) : null), [today, graph]);

  function toggleHaptics() {
    const next = !hapticsOn;
    hapticsRef.current = next;
    setHapticsOn(next);
    void setSetting(HAPTICS_SETTING, next);
    if (next) vibrate(); // one buzz to show it's back on
  }

  function toggleSuggestions() {
    const next = !suggestionsOn;
    setSuggestionsOn(next);
    void setSetting(SUGGESTIONS_SETTING, next);
    inputRef.current?.focus();
  }


  // Autocomplete: always the whole world (all 195 countries, or their capitals), named or not,
  // so the list never reveals which answers count in this round.
  const suggestions = useMemo(
    () => (isPlaying && suggestionsOn && value.trim() ? suggestCountries(value, index) : null),
    [isPlaying, suggestionsOn, value, index],
  );
  const suggestionOptions = useMemo<ClayInputOption[]>(
    () =>
      suggestions?.map((s) => ({ key: s.country.code, label: s.label, detail: s.via ? `as ${s.via}` : undefined })) ??
      NO_OPTIONS,
    [suggestions],
  );

  // A round counts as assisted once the list has shown the player any answers.
  const showingSuggestions = suggestionOptions.length > 0;
  useEffect(() => {
    if (showingSuggestions && !session.assisted) dispatch({ type: "assist" });
  }, [showingSuggestions, session.assisted]);

  // A picked suggestion is submitted at once, with no typo pause. It may not count here:
  // the list is global, so it can offer Brazil in a Europe round, or a country already named.
  function pickSuggestion(option: ClayInputOption) {
    const country = index.byCode.get(option.key);
    if (!isPlaying || !country) return;
    if (alreadyNamed.has(country.code)) {
      dispatch({ type: "miss" });
      say("warn", `${option.label} is already on your list.`);
    } else if (!scope.has(country.code)) {
      dispatch({ type: "miss" });
      say("warn", outOfScopeMessage(country, option.label));
    } else {
      accept(country, option.label, 0, { label: option.label, picked: true });
    }
    inputRef.current?.focus();
  }

  function say(tone: NonNullable<Feedback>["tone"], text: string) {
    setFeedback({ tone, text });
    setAttempt((n) => n + 1);
  }

  function requestHint() {
    if (!isPlaying || session.hintsUsed >= MAX_HINTS) return;
    const stage = session.hintsUsed + 1;
    let target: string | null = null;
    if (stage === 1) {
      target = pickHintTarget(missing, { scope: targetSet, named: namedSet, needsBorders: true })?.code ?? null;
    } else if (stage === 2) {
      // Outline the stage-1 country, unless the player has already found it.
      const previous = session.hintTargets[0];
      target =
        previous && !namedSet.has(previous)
          ? previous
          : (pickHintTarget(missing, { scope: targetSet, named: namedSet, needsBorders: false })?.code ?? null);
    }
    dispatch({ type: "hint", target });
    inputRef.current?.focus();
  }

  function beginRound() {
    setValue("");
    setFeedback(null);
    setChallengeNotice(null);
    setPresses(0);
    startedAt.current = Date.now();
  }

  function startRoute(puzzle = pickRoute(graph), dailyDate: string | null = null, challenge = false) {
    if (!puzzle) return;
    dispatch({ type: "startRoute", puzzle, daily: dailyDate, challenge });
    setSetupMode("pathfinding");
    beginRound();
  }

  function start(
    key: RoundKey,
    answer: AnswerKind = answerSetting,
    dailyDate: string | null = null,
    targetCodes = rounds.get(key)!.targetCodes,
  ) {
    const round = rounds.get(key)!;
    dispatch({ type: "start", mode: round.mode, roundKey: key, targetCodes, answer, daily: dailyDate });
    setSetupMode(round.mode);
    beginRound();
  }

  /**
   * A challenge link (?route=FRA-CHN): skip the setup screen and start that route. Every phone
   * plays it on the same bundled border data, so it's the same puzzle for everyone. A bad link
   * falls back to the setup screen with the reason.
   */
  function openChallenge(raw: string) {
    // A scanned challenge goes straight in: no boot-up splash in the way.
    setSplash("gone");
    // Drop the parameter so a reload or "Choose another round" doesn't relaunch it.
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.hash);
    document.documentElement.removeAttribute("data-challenge");
    const result = parseRouteParam(raw, graph, (code) => countryIndex.byCode.get(code)?.name);
    if (!result.ok) {
      setChallengeNotice(result.reason);
      return;
    }
    if (status === "playing") return; // never interrupt a round in progress
    startRoute(result.puzzle, null, true);
  }

  /** Today's seeded puzzle. A replay plays the same puzzle as an ordinary round, so only the first try is the daily result. */
  function startDaily(replay: boolean) {
    const date = dateKey(); // re-read: the setup screen may have been open since yesterday
    setToday(date);
    const challenge = dailyChallenge(date, graph, CONTINENTS);
    const dailyDate = replay ? null : date;
    if (challenge.kind === "pathfinding") startRoute(challenge.puzzle, dailyDate);
    else start(challenge.continent, "countries", dailyDate);
  }

  /* ---------------- Party Mode (pass-and-play) ---------------- */

  /** Shows a result on the leaderboard at once, saves it, then shows what IndexedDB holds. */
  function recordPartyResult(result: PartyResult) {
    setPartyResults((prev) => [...prev.filter((r) => r.player !== result.player), result]);
    void savePartyResult(result)
      .then(() => listPartyResults(result.party))
      .then((saved) => {
        // Keep the in-memory board if storage is unavailable or lost a write.
        if (saved && saved.some((r) => r.player === result.player)) setPartyResults(saved);
      });
  }

  /** "Next Player": the same route for the next person, after a hand-over screen. */
  function nextPlayer() {
    if (!session.route || session.elapsedMs === null) return;
    let current = party;
    if (!current) {
      // The round just played becomes player 1's turn (it's already in the profile, as usual).
      current = { id: newPartyId(), route: routeParam(session.route), player: 1, round: session.round, handoff: false };
      recordPartyResult({
        party: current.id,
        route: current.route,
        player: 1,
        won: session.status === "won",
        timeMs: session.elapsedMs,
        moves: session.moves,
        finishedAt: Date.now(),
      });
    }
    setParty({ ...current, player: current.player + 1, round: null, handoff: true });
  }

  /** The next player taps Start: the same route, a fresh clock from 00:00. */
  function startPartyTurn() {
    if (!party || !session.route) return;
    startRoute(session.route, null, false);
    setParty({ ...party, handoff: false, round: session.round + 1 });
  }

  function endParty() {
    setParty(null);
    setPartyResults([]);
  }

  function accept(
    country: Country,
    typed: string,
    distance: number,
    { label = answerForInput(index, country.code, typed), picked = false }: { label?: string; picked?: boolean } = {},
  ) {
    const what = isCapitals ? `${label}, capital of ${country.name}` : country.name;
    const recognized =
      distance === 0
        ? `Recognized: ${what}`
        : `Recognized: ${what} (from "${typed}", ${distance} edit${distance === 1 ? "" : "s"} away)`;
    // Hinted: the initials of every missing answer are showing, or a hint was about this country.
    const [stage1, stage2] = session.hintTargets;
    const hinted =
      session.hintsUsed >= 3 ||
      (session.hintsUsed >= 1 && stage1 === country.code) ||
      (session.hintsUsed >= 2 && stage2 === country.code);
    const guess: Guess = { country, typed, distance, label, at: Date.now() - startedAt.current, hinted, picked };
    if (isRoute && route) {
      const stepsBack = country.code === route.start || namedSet.has(country.code);
      const complete = reachesEnd(graph, route, country.code);
      dispatch({ type: "step", guess, complete });
      if (complete) buzz(); // route finished
      say("ok", stepsBack ? `Back to ${country.name}.` : recognized);
    } else {
      dispatch({ type: "guess", guess });
      say("ok", recognized);
    }
    setValue("");
    setPresses((n) => n + 1);
    inputRef.current?.focus();
  }

  /** Why a recognized answer doesn't count right now. `label`: what the player gave (a capital in Capitals mode). */
  function outOfScopeMessage(country: Country, label = country.name): string {
    if (isRoute) {
      return country.code === here ? `You're already in ${country.name}.` : `${country.name} doesn't border ${hereName}.`;
    }
    const why = current?.outOfScope?.(country.name) ?? `${country.name} isn't part of this round.`;
    return isCapitals ? `${label} is the capital of ${country.name}. ${why}` : why;
  }

  /** Capitals mode: the player typed a country's name instead of its capital. */
  function countryNameInstead(typed: string): Country | null {
    if (!isCapitals) return null;
    const codes = countryIndex.exact.get(normalize(typed));
    return codes?.length === 1 ? countryIndex.byCode.get(codes[0])! : null;
  }

  // Every keystroke: accept complete, unambiguous names instantly.
  function onType(next: string) {
    setValue(next);
    if (!isPlaying) return;
    const decision = liveMatch(next, index, { scope, named: alreadyNamed });
    if (decision.action === "accept") {
      accept(decision.country, next.trim(), 0);
      return;
    }
    // The player is still typing: drop messages about earlier text, keep the last success.
    if (feedback && feedback.tone !== "ok") setFeedback(null);
  }

  // When typing pauses: accept typo-corrected names, or explain why nothing happened.
  useEffect(() => {
    if (!isPlaying || !value.trim()) return;
    const id = setTimeout(() => {
      const decision = liveMatch(value, index, { scope, named: alreadyNamed });
      if (decision.action === "acceptAfterPause") {
        accept(decision.country, value.trim(), decision.distance);
      } else if (decision.action === "hold") {
        say(
          "hint",
          decision.distance === 0
            ? `${decision.country.name}: press Enter to add it, or keep typing.`
            : "Press Enter to check it, or keep typing.",
        );
      } else if (decision.action === "alreadyNamed") {
        say("warn", `${answerForInput(index, decision.country.code, value)} is already on your list.`);
      } else {
        // A complete, exact name that doesn't count here: say so without waiting for Enter.
        const result = matchCountry(value, index, { scope });
        if (result.status === "out_of_scope" && result.distance === 0) {
          say("warn", outOfScopeMessage(result.country, answerForInput(index, result.country.code, value)));
        } else if (result.status === "no_match") {
          const country = countryNameInstead(value);
          if (country) say("hint", `${country.name} is a country. Name its capital.`);
        }
      }
    }, TYPO_ACCEPT_DELAY_MS);
    return () => clearTimeout(id);
    // accept(), say() and outOfScopeMessage() only read state listed in these dependencies.
  }, [value, isPlaying, index, scope, alreadyNamed]);

  // Enter (or Check): accept whatever matches, or say why not.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isPlaying) return;
    const typed = value.trim();
    const result = matchCountry(typed, index, { scope });

    switch (result.status) {
      case "match":
        if (alreadyNamed.has(result.country.code)) {
          dispatch({ type: "miss" });
          say("warn", `${answerForInput(index, result.country.code, typed)} is already on your list.`);
        } else accept(result.country, typed, result.distance);
        break;
      case "ambiguous":
        dispatch({ type: "miss" });
        say(
          "warn",
          `"${typed}" is equally close to ${result.candidates.map((c) => answerForInput(index, c.code, typed)).join(" and ")}. Type a little more.`,
        );
        break;
      case "out_of_scope":
        dispatch({ type: "miss" });
        say("warn", outOfScopeMessage(result.country, answerForInput(index, result.country.code, typed)));
        break;
      case "no_match": {
        if (result.reason === "empty") break;
        dispatch({ type: "miss" });
        const country = countryNameInstead(typed);
        say(
          country ? "warn" : "error",
          country
            ? `${country.name} is a country. Name its capital.`
            : result.reason === "too_short"
              ? `"${typed}" is too short to guess at. Short answers must be exact (e.g. ${isCapitals ? '"DC"' : '"UK", "USA", "DRC"'}).`
              : `"${typed}" isn't recognized as ${isCapitals ? "a capital city" : "a sovereign state"}.`,
        );
        break;
      }
    }
    inputRef.current?.focus();
  }

  // Leaving the route (a new route, another round, the menu) ends the party.
  useEffect(() => {
    if (!party || party.handoff) return;
    if (status === "setup" || party.round !== session.round) {
      setParty(null);
      setPartyResults([]);
    }
  }, [party, status, session.round]);

  // The hand-over screen: focus its heading, for keyboard and screen-reader users.
  useEffect(() => {
    if (party?.handoff) handoffHeadingRef.current?.focus();
  }, [party?.handoff, party?.player]);

  // Keyboard and screen-reader users land on the result when the round ends.
  useEffect(() => {
    if (isOver) resultHeadingRef.current?.focus();
  }, [isOver]);

  // Spoiler-free result for the Share button, once the Timer has reported the final time.
  const shareText = useMemo(() => {
    if (!isOver || session.elapsedMs === null) return null;
    const common = {
      daily: session.daily,
      won: session.status === "won",
      timeMs: session.elapsedMs,
      assisted: session.assisted,
    };
    if (session.mode === "pathfinding" && session.route) {
      return buildShareText({
        ...common,
        kind: "route",
        title: session.challenge ? "Pathfinding Challenge" : "Pathfinding",
        moves: session.moves,
        par: session.route.par,
        grid: routeGrid(graph, session.route, session.path),
      });
    }
    if (!current) return null;
    return buildShareText({
      ...common,
      kind: "list",
      title: isCapitals ? `${current.title} Capitals` : current.title,
      emoji: isCapitals ? "🏙️" : current.emoji,
      named: session.guesses.length,
      total: session.targetCodes.length,
      hints: session.hintsUsed,
      grid: paceGrid(
        session.guesses.map((g) => g.at ?? 0),
        session.targetCodes.length,
      ),
    });
  }, [isOver, session, graph, current, isCapitals]);

  // Save each finished round to the local profile, once the Timer has reported the final time.
  const savedRound = useRef(0);
  useEffect(() => {
    const { elapsedMs } = session;
    if (!isOver || elapsedMs === null || savedRound.current === session.round) return;
    savedRound.current = session.round;
    // A party turn (player 2 onwards): to the party's leaderboard, never the profile.
    if (party && !party.handoff && party.round === session.round && session.route) {
      const result: PartyResult = {
        party: party.id,
        route: party.route,
        player: party.player,
        won: session.status === "won",
        timeMs: elapsedMs,
        moves: session.moves,
        finishedAt: Date.now(),
      };
      recordPartyResult(result);
      return;
    }
    const common = {
      result: session.status === "won" ? "won" : "forfeited",
      timeMs: elapsedMs,
      guesses: session.attempts,
      correct: session.guesses.length,
      hintsUsed: session.hintsUsed,
      assisted: session.assisted,
      finishedAt: Date.now(),
      daily: session.daily,
      share: shareText ?? undefined,
    } as const;
    let record: Omit<RoundRecord, "id"> | null = null;
    if (session.mode === "pathfinding" && session.route) {
      const { start, end, par } = session.route;
      const name = (code: string) => countryIndex.byCode.get(code)?.name ?? code;
      record = { ...common, mode: "pathfinding", roundKey: `${start}-${end}`, label: `${name(start)} to ${name(end)}`, target: par, moves: session.moves, par };
    } else if (session.roundKey) {
      const title = rounds.get(session.roundKey)?.title ?? session.roundKey;
      const capitals = session.answer === "capitals";
      record = {
        ...common,
        mode: session.mode,
        // Capitals rounds keep their own personal bests.
        roundKey: capitals ? `${session.roundKey}:capitals` : session.roundKey,
        label: capitals ? `${title} capitals` : title,
        answer: session.answer,
        target: session.targetCodes.length,
        moves: null,
        par: null,
        // Each answer's time since the one before: the recall heatmap's data.
        answers: session.guesses.map((g, i) => ({
          code: g.country.code,
          ms: Math.max(0, (g.at ?? 0) - (i > 0 ? (session.guesses[i - 1].at ?? 0) : 0)),
          hinted: g.hinted ?? false,
          picked: g.picked ?? false,
        })),
      };
    }
    if (record) void saveRound(record);
  }, [isOver, session, countryIndex, rounds, shareText, party]);

  const total = session.targetCodes.length;
  const missed = status === "forfeited" ? missing : [];
  const finalTime = session.elapsedMs === null ? "…" : formatElapsed(session.elapsedMs);
  const hintsPhrase =
    session.hintsUsed === 0 ? "no hints" : session.hintsUsed === 1 ? "1 hint" : `${session.hintsUsed} hints`;
  const [stage1Code, stage2Code] = session.hintTargets;
  const borderTarget = stage1Code ? (index.byCode.get(stage1Code) ?? null) : null;
  const borderNeighbors = borderTarget
    ? borderTarget.borders.flatMap((code) => index.byCode.get(code) ?? []).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const outlineTarget = stage2Code ? (index.byCode.get(stage2Code) ?? null) : null;
  const highlight = isPlaying && session.hintsUsed >= 2 ? stage2Code : null;
  // Chips take the round's color; in World Mode each takes its own continent's.
  const chipRegion = (c: Country) => (current?.theme ? undefined : c.region);

  // Pathfinding map: framed around one shortest route; start and end always shown.
  const routeFrame = useMemo(() => (route ? { around: route.shortest } : null), [route]);
  const won = status === "won";
  // In a party the shortest route stays hidden (the next player would see it), unless revealed.
  const hideSolution = party !== null && revealedRound !== session.round;
  const handingOver = party?.handoff === true;
  // Given up: the countries of one shortest route the player never stepped into, shown in red.
  const routeMissed = useMemo(
    () =>
      route && status === "forfeited" && !hideSolution
        ? new Set(route.shortest.slice(1, -1).filter((code) => !namedSet.has(code)))
        : null,
    [route, status, namedSet, hideSolution],
  );
  const routeEndpoints = useMemo(
    () =>
      route
        ? {
            start: { code: route.start, name: index.byCode.get(route.start)!.name },
            end: { code: route.end, name: index.byCode.get(route.end)!.name },
            reached: won,
          }
        : undefined,
    [route, index, won],
  );
  /* ---------------- Map taps ----------------
     During a round the map is inert until all three hints are used; then tapping a
     country of the round shows its initials (or its name, once named). After the round,
     tapping any country shows its name (and capital in Capitals mode). */
  const mapStageRef = useRef<HTMLDivElement>(null);
  const [mapTap, setMapTap] = useState<{
    code: string;
    x: number;
    y: number;
    round: number;
    status: GameStatus;
    taps: number;
  } | null>(null);
  // Read by the (stable) click handler, so SvgMap's memo isn't broken by a new callback each render.
  const tapContext = useRef({ round: session.round, status });
  useEffect(() => {
    tapContext.current = { round: session.round, status };
  });
  const mapClickable = useMemo<ReadonlySet<string> | null>(() => {
    if (isOver) return playable;
    if (isPlaying && !isRoute && session.hintsUsed >= MAX_HINTS) return targetSet;
    return null; // fewer than 3 hints: no peeking
  }, [isOver, isPlaying, isRoute, session.hintsUsed, playable, targetSet]);
  const onMapClick = useCallback((code: string | null, at: { clientX: number; clientY: number }) => {
    const stage = mapStageRef.current;
    if (!code || !stage) {
      setMapTap(null);
      return;
    }
    buzz(); // a country that shows something (its initials, or its name)
    const rect = stage.getBoundingClientRect();
    setMapTap((prev) => ({
      code,
      x: at.clientX - rect.left,
      y: at.clientY - rect.top,
      ...tapContext.current,
      taps: (prev?.taps ?? 0) + 1,
    }));
  }, [buzz]);

  /** What a tap on this country reveals right now, or null if nothing. */
  function mapTipFor(code: string): { title: string; detail?: string; announce: string } | null {
    const c = countryIndex.byCode.get(code);
    if (!c || !mapClickable?.has(code)) return null;
    const capitals = `${c.capitals.length > 1 ? "Capitals" : "Capital"}: ${c.capitals.join(", ")}`;
    if (isOver) {
      return isCapitals ? { title: c.name, detail: capitals, announce: `${c.name}. ${capitals}.` } : { title: c.name, announce: c.name };
    }
    const named = guesses.find((g) => g.country.code === code);
    if (named) {
      return isCapitals
        ? { title: named.label ?? c.capitals[0], detail: c.name, announce: `${named.label ?? c.capitals[0]}, ${c.name}` }
        : { title: c.name, announce: c.name };
    }
    const initials = initialsOf(isCapitals ? (c.capitals[0] ?? c.name) : c.name);
    return { title: initials, announce: `Initials: ${initials}` };
  }
  const tipOpen = mapTap !== null && mapTap.round === session.round && mapTap.status === status;
  const tip = tipOpen ? mapTipFor(mapTap.code) : null;
  const mapNote = !mapClickable
    ? null
    : isOver
      ? `Tap any country to see its name${isCapitals ? " and capital" : ""}.`
      : isCapitals
        ? "Tap a country of this round to see its capital's initials."
        : "Tap a missing country to see its initials.";

  // The tooltip stays up after the finger lifts; it closes on the next tap elsewhere, or Escape.
  const tipShown = tip !== null;
  useEffect(() => {
    if (!tipShown) return;
    const close = () => setMapTap(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onPointerDown = (e: PointerEvent) => {
      if (!mapStageRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [tipShown]);

  /** The tooltip and its screen-reader announcement, inside the map's positioned stage. */
  const mapOverlay = (
    <>
      {tip && mapTap && <MapTooltip key={mapTap.taps} tip={{ x: mapTap.x, y: mapTap.y, title: tip.title, detail: tip.detail }} />}
      <p className="visually-hidden" aria-live="polite">
        {tip?.announce ?? ""}
      </p>
    </>
  );

  // "Share via QR": a link to this exact route, built from wherever the game is running
  // (window.location.origin), so it's right on localhost, a preview and production alike.
  // Only built after a round, on the client.
  const challengeLink =
    isOver && route && typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}?route=${routeParam(route)}`
      : null;
  // Which round's QR modal is open; a new round closes it.
  const [qrRound, setQrRound] = useState<number | null>(null);
  const qrOpen = qrRound === session.round && challengeLink !== null;
  const closeQr = useCallback(() => setQrRound(null), []);
  // Fetch the QR chunk while the player reads the result, so the modal opens instantly.
  const routeOver = isOver && isRoute;
  useEffect(() => {
    if (routeOver) void loadQrShareModal();
  }, [routeOver]);
  // And once, shortly after the page loads, so the service worker caches it for offline play.
  useEffect(() => {
    const timer = setTimeout(() => void loadQrShareModal(), QR_PRELOAD_MS);
    return () => clearTimeout(timer);
  }, []);
  const movesWord = (n: number) => (n === 1 ? "1 move" : `${n} moves`);
  const roundTitle = current ? (isCapitals ? `${current.title} capitals` : current.title) : null;
  /** The answer shown for a country this round: its name, or its capital. */
  const answerOf = (c: Country) => (isCapitals ? answerLabel(capitalIndex, c.code) : c.name);
  const setupNoun = answerSetting === "capitals" ? "capitals" : "countries";
  const answerSwitch = (
    <div className="answer-switch" role="group" aria-label="What to name">
      <span className="answer-switch__label" aria-hidden="true">
        Name the
      </span>
      {(["countries", "capitals"] as const).map((answer) => (
        <ClayButton
          key={answer}
          variant="soft"
          size="sm"
          className="mode-option"
          aria-pressed={answerSetting === answer}
          onClick={() => chooseAnswer(answer)}
        >
          {answer === "countries" ? "Countries" : "Capitals"}
        </ClayButton>
      ))}
    </div>
  );
  const shortestBetween = route ? route.shortest.slice(1, -1).map(nameOf) : [];

  /** "Save Score": the won route as a keepsake PNG card, downloaded. */
  async function saveScore() {
    const svg = mapStageRef.current?.querySelector<SVGSVGElement>("svg.world-map");
    if (!route || !svg || session.elapsedMs === null) return;
    const round = session.round;
    setScoreCard({ round, state: "saving" });
    const title = `${nameOf(route.start)} to ${nameOf(route.end)}`;
    const date = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const details = [party ? `Player ${party.player}` : null, movesWord(session.moves), `shortest ${route.par}`, date]
      .filter(Boolean)
      .join(" · ");
    // The heatmap: each step of the final route, and how long it took since the one before.
    const heat = session.guesses.map((g, i) => ({
      code: g.country.code,
      seconds: Math.max(0, ((g.at ?? 0) - (i > 0 ? (session.guesses[i - 1].at ?? 0) : 0)) / 1000),
    }));
    try {
      const blob = await renderScoreCard({
        map: svg,
        logo: document.querySelector<HTMLImageElement>("img.brand-logo"),
        title,
        time: finalTime,
        details,
        heat,
      });
      if (!blob) throw new Error("This browser can't draw the card");
      downloadBlob(blob, scoreCardFileName(title));
      setScoreCard({ round, state: "saved" });
    } catch {
      setScoreCard({ round, state: "failed" });
    }
  }
  const scoreCardState = scoreCard?.round === session.round ? scoreCard.state : null;

  // The transparent logo, straight on the page background: no tile, no badge, no text.
  // Its height is set in CSS (.brand-logo); its alt text names the heading it sits in.
  const logo = <img className="brand-logo" src={LOGO_SRC} alt={BRAND_NAME} />;

  return (
    <>
      {splash !== "gone" && (
        <SplashScreen
          prepare={prepareGame}
          leaving={splash === "leaving"}
          onPlay={() => {
            buzz();
            setSplash("leaving");
          }}
        />
      )}

      {/* While the splash is up, the game is inert: no focus, hidden from screen readers. */}
      <div className="game-shell" inert={splash === "open" || undefined}>
      <header className="game-header">
        {/* The logo, with the vibration toggle at the far right of its row. */}
        <div className="brand-row">
          {status === "setup" ? (
            <h1 className="game-title brand-title" ref={titleRef} tabIndex={-1}>
              {logo}
            </h1>
          ) : (
            logo
          )}
          {hapticsOffered && (
            <button
              type="button"
              className="haptics-toggle"
              aria-label="Vibration"
              aria-pressed={hapticsOn}
              title={hapticsOn ? "Vibration on" : "Vibration off"}
              onClick={toggleHaptics}
            >
              <VibrationIcon off={!hapticsOn} />
            </button>
          )}
        </div>
        {status === "setup" ? (
          <p className="game-tagline">{answerSetting === "capitals" ? "Name every capital." : "Name every country."}</p>
        ) : (
          <div className="game-heading">
            <h1 className="game-title">
              {isRoute && route ? `${nameOf(route.start)} to ${nameOf(route.end)}` : roundTitle}
              {session.daily && <span className="daily-badge">Daily</span>}
              {party && <span className="daily-badge party-badge">Player {party.player}</span>}
            </h1>
          </div>
        )}
        {status !== "setup" && !handingOver && (
          <div className="stats">
            {isRoute ? (
              <p className="counter">
                <span key={session.moves} className={session.moves ? "counter-value counter-value--bump" : "counter-value"}>
                  {session.moves}
                </span>
                <span className="counter-total">{session.moves === 1 ? "move" : "moves"}</span>
              </p>
            ) : (
              <p className="counter">
                <span key={guesses.length} className={guesses.length ? "counter-value counter-value--bump" : "counter-value"}>
                  {guesses.length}
                </span>
                <span className="counter-total">/ {total}</span>
                <span className="visually-hidden"> {isCapitals ? "capitals" : "countries"} named</span>
              </p>
            )}
            <Timer
              key={session.round}
              isPlaying={isPlaying}
              onStop={(elapsedMs) => dispatch({ type: "timerStopped", elapsedMs })}
            />
          </div>
        )}
      </header>

      <Suspense fallback={null}>
        <RouteChallengeParam onRoute={openChallenge} />
      </Suspense>

      {/* Shown instead of the setup screen while a challenge link is opening (see layout.tsx). */}
      {status === "setup" && (
        <p className="challenge-pending" role="status">
          Opening your challenge…
        </p>
      )}

      {status === "setup" && challengeNotice && (
        <ClayCard as="section" className="notice-card setup-only" aria-labelledby="notice-heading">
          <h2 id="notice-heading" className="card-title">
            That challenge link didn&apos;t work
          </h2>
          <p className="card-lead" role="status">
            {challengeNotice} Pick a round below instead.
          </p>
          <ClayButton variant="soft" size="sm" onClick={() => setChallengeNotice(null)}>
            Dismiss
          </ClayButton>
        </ClayCard>
      )}

      {status === "setup" && daily && <DailyCard challenge={daily} onPlay={startDaily} />}

      {status === "setup" && (
        <ClayCard as="section" className="setup-only" aria-labelledby="setup-heading">
          <div className="mode-switch" role="group" aria-label="Game mode">
            {SETUP_TABS.map(({ tab, label }) => (
              <ClayButton
                key={tab}
                variant="soft"
                size="sm"
                className={tab === "profile" ? "mode-option mode-option--profile" : "mode-option"}
                aria-pressed={setupMode === tab}
                onClick={() => setSetupMode(tab)}
              >
                {label}
              </ClayButton>
            ))}
          </div>

          {setupMode === "profile" && <ProfilePanel headingId="setup-heading" countries={countries} />}

          {setupMode === "continent" && (
            <>
              <h2 id="setup-heading" className="card-title">
                Pick a continent
              </h2>
              <p className="card-lead">
                {answerSetting === "capitals"
                  ? "Name the capital of every sovereign state in it."
                  : "Name every sovereign state in it."}{" "}
                The timer starts as soon as you pick.
              </p>
              {answerSwitch}
              <div className="continent-grid">
                {CONTINENTS.map((c) => (
                  <ClayButton key={c} variant="soft" data-region={c} className="continent-button" onClick={() => start(c)}>
                    <span className="continent-name">{c}</span>
                    <span className="continent-count">
                      {rounds.get(c)!.targetCodes.length} {setupNoun}
                    </span>
                  </ClayButton>
                ))}
              </div>
            </>
          )}

          {setupMode === "historical" && (
            <>
              <h2 id="setup-heading" className="card-title">
                Pick an empire
              </h2>
              <p className="card-lead">
                {answerSetting === "capitals"
                  ? "Name the capital of every modern country whose land was once part of it."
                  : "Name every modern country whose land was once part of it."}{" "}
                The timer starts as soon as you pick.
              </p>
              {answerSwitch}
              <div className="continent-grid">
                {empires.map((e) => (
                  <ClayButton
                    key={e.key}
                    variant="soft"
                    data-theme={e.key}
                    className="continent-button"
                    onClick={() => start(e.key)}
                  >
                    <span className="continent-name">{e.title}</span>
                    <span className="continent-count">{e.era}</span>
                    <span className="continent-count">
                      {e.codes.length} {setupNoun}
                    </span>
                  </ClayButton>
                ))}
              </div>
            </>
          )}

          {setupMode === "pathfinding" && (
            <>
              <h2 id="setup-heading" className="card-title">
                Find a land route
              </h2>
              <p className="card-lead">
                You get a start and a destination. Get there by naming countries that share a land border, each one
                bordering the last. The timer starts when you press Start.
              </p>
              <div className="continent-grid">
                <ClayButton className="continent-button" onClick={() => startRoute()}>
                  <span className="continent-name">Start</span>
                  <span className="continent-count">
                    Random route, {MIN_PAR}–{MAX_PAR} countries apart
                  </span>
                </ClayButton>
              </div>
            </>
          )}

          {setupMode === "world" && (
            <>
              <h2 id="setup-heading" className="card-title">
                The whole world
              </h2>
              <p className="card-lead">
                {answerSetting === "capitals" ? "The capital of every sovereign state on Earth" : "Every sovereign state on Earth"},
                in one sitting. The timer starts when you press Start.
              </p>
              {answerSwitch}
              <div className="continent-grid">
                <ClayButton className="continent-button" onClick={() => start("World")}>
                  <span className="continent-name">Start</span>
                  <span className="continent-count">
                    {rounds.get("World")!.targetCodes.length} {setupNoun}
                  </span>
                </ClayButton>
              </div>
            </>
          )}
        </ClayCard>
      )}

      {isPlaying && (
        <ClayCard as="section" aria-label="Your answer">
          {isRoute && (
            <p className="route-prompt">
              You&apos;re in <strong>{hereName}</strong>. Name a country that borders it.
            </p>
          )}
          <form onSubmit={onSubmit} className="entry">
            <ClayInput
              label={isCapitals ? "Capital city" : "Country name"}
              hideLabel
              ref={inputRef}
              value={value}
              onChange={(e) => onType(e.target.value)}
              placeholder={isCapitals ? "Type a capital" : "Type a country"}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="enter"
              autoFocus
              data-press={presses === 0 ? undefined : presses % 2 ? "a" : "b"}
              // A warning about this text sits under the field: close the list so it can be read.
              suggestions={
                suggestionsOn ? (feedback?.tone === "warn" || feedback?.tone === "error" ? NO_OPTIONS : suggestionOptions) : undefined
              }
              onPickSuggestion={pickSuggestion}
            />
            <ClayButton type="submit">Check</ClayButton>
          </form>

          <div className="answer-footer">
            {/* The live region stays mounted so screen readers announce each new message. */}
            <div className="feedback-region" aria-live="polite">
              {feedback && (
                <p key={attempt} className={`feedback feedback--${feedback.tone}`}>
                  {feedback.text}
                </p>
              )}
            </div>
            <div className="answer-actions">
              <ClayButton
                variant="soft"
                size="sm"
                className="mode-option suggest-toggle"
                aria-pressed={suggestionsOn}
                onClick={toggleSuggestions}
              >
                Suggestions
                <span className="suggest-toggle__state" aria-hidden="true">
                  {suggestionsOn ? "On" : "Off"}
                </span>
              </ClayButton>
              {/* Routes have Give Up under the map instead. */}
              {!isRoute && (
                <ClayButton variant="soft" size="sm" onClick={() => dispatch({ type: "forfeit" })}>
                  Forfeit
                </ClayButton>
              )}
            </div>
          </div>
        </ClayCard>
      )}

      {isPlaying && !isRoute && (
        <HintPanel
          used={session.hintsUsed}
          borderTarget={borderTarget}
          borderNeighbors={borderNeighbors}
          outlineTarget={outlineTarget}
          named={namedSet}
          missing={missing}
          capitals={isCapitals}
          onRequest={requestHint}
        />
      )}

      {handingOver && party && route && (
        <ClayCard as="section" aria-labelledby="handoff-heading" data-theme="Pathfinding" className="handoff-card">
          <p className="handoff-card__eyebrow">Pass and play</p>
          <h2 id="handoff-heading" ref={handoffHeadingRef} tabIndex={-1} className="card-title result-title">
            Player {party.player}, you&apos;re up
          </h2>
          <p className="card-lead">
            Same route: {nameOf(route.start)} to {nameOf(route.end)}. Hand over the device; the clock starts at 00:00
            when you tap Start.
          </p>
          {partyResults.length > 0 && <PartyBoard results={partyResults} current={null} />}
          <div className="result-actions">
            <ClayButton onClick={startPartyTurn}>Start</ClayButton>
            <ClayButton variant="soft" onClick={endParty}>
              End party
            </ClayButton>
          </div>
        </ClayCard>
      )}

      {isOver && isRoute && route && !handingOver && (
        <ClayCard as="section" aria-labelledby="result-heading" data-theme="Pathfinding">
          <h2 id="result-heading" ref={resultHeadingRef} tabIndex={-1} className="card-title result-title">
            {party && `Player ${party.player}: `}
            {won ? `You reached ${nameOf(route.end)}` : "Route abandoned"}
          </h2>
          <p className="card-lead">
            {won
              ? `${nameOf(route.start)} to ${nameOf(route.end)} in ${movesWord(session.moves)}, ${finalTime}. The shortest route has ${route.par} countries in between.`
              : `You forfeited at ${finalTime} after ${movesWord(session.moves)}.`}
          </p>
          {hideSolution ? (
            <div className="solution-hidden">
              <p className="card-lead">The shortest route stays hidden while the party is on, so the next player can&apos;t see it.</p>
              <ClayButton variant="soft" size="sm" onClick={() => setRevealedRound(session.round)}>
                Show the shortest route
              </ClayButton>
            </div>
          ) : (
            <>
              <p className="card-lead">One shortest route:</p>
              <ol className="raw-list route-list" aria-label="One shortest route">
                {shortestBetween.map((name) => (
                  <li key={name} className="chip chip--missed">
                    <span className="chip-name">{name}</span>
                  </li>
                ))}
              </ol>
            </>
          )}
          {shareText && <ShareResult text={shareText} />}
          {/* Straight on to another route, no menu; or share this one, or keep it. */}
          <div className="route-next">
            <div className="route-next__buttons">
              <ClayButton className="route-next__new" onClick={() => startRoute()}>
                Generate New Route
              </ClayButton>
              {challengeLink && (
                <ClayButton variant="soft" aria-haspopup="dialog" onClick={() => setQrRound(session.round)}>
                  Share via QR
                </ClayButton>
              )}
              {won && (
                <ClayButton
                  variant="soft"
                  className="save-score"
                  onClick={() => void saveScore()}
                  disabled={scoreCardState === "saving" || session.elapsedMs === null}
                >
                  {scoreCardState === "saving" ? "Saving…" : "Save Score"}
                </ClayButton>
              )}
            </div>
            {challengeLink && <p className="qr-share__note">Another phone scans the QR code to play this exact route.</p>}
            <p className="save-score__status" role="status">
              {scoreCardState === "saved"
                ? "Score card saved as a PNG."
                : scoreCardState === "failed"
                  ? "Couldn't make the score card in this browser."
                  : ""}
            </p>
          </div>
          {/* Party Mode: the same route for the next person. */}
          <div className="party-zone">
            {party && partyResults.length > 0 && <PartyBoard results={partyResults} current={party.player} />}
            <div className="party-zone__row">
              <ClayButton variant="soft" onClick={nextPlayer} disabled={session.elapsedMs === null}>
                Next Player
              </ClayButton>
              <p className="party-zone__note">
                {party
                  ? `Player ${party.player + 1} plays this same route, from 00:00.`
                  : "Pass and play: the next person plays this same route, from 00:00. Times are ranked here."}
              </p>
            </div>
          </div>
          {qrOpen && (
            <Suspense fallback={null}>
              <QrShareModal url={challengeLink} routeName={`${nameOf(route.start)} to ${nameOf(route.end)}`} onClose={closeQr} />
            </Suspense>
          )}
          <div className="result-actions">
            {session.challenge && (
              <ClayButton variant="soft" onClick={() => startRoute(route, null, true)}>
                Play this route again
              </ClayButton>
            )}
            <ClayButton variant="soft" onClick={() => dispatch({ type: "reset" })}>
              Choose another round
            </ClayButton>
          </div>
        </ClayCard>
      )}

      {isOver && current && (
        <ClayCard as="section" aria-labelledby="result-heading" data-theme={current.theme ?? undefined}>
          <h2 id="result-heading" ref={resultHeadingRef} tabIndex={-1} className="card-title result-title">
            {status === "won" ? `All ${total} named` : `${guesses.length} of ${total} named`}
          </h2>
          <p className="card-lead">
            {status === "won"
              ? `${isCapitals ? current.capitalsPhrase : current.everyPhrase}, in ${finalTime}, with ${hintsPhrase}.`
              : missed.length === 1
                ? `You forfeited at ${finalTime}, with ${hintsPhrase}. Here's the one you missed.`
                : `You forfeited at ${finalTime}, with ${hintsPhrase}. Here are the ${missed.length} you missed.`}
          </p>
          {missed.length > 0 && (
            <ul className="raw-list missed-list" aria-label={isCapitals ? "Capitals you missed" : "Countries you missed"}>
              {missed.map((c) => (
                <li key={c.code} className="chip chip--missed" data-region={chipRegion(c)}>
                  <span className="chip-name">{answerOf(c)}</span>
                  {isCapitals && <span className="chip-typed">{c.name}</span>}
                </li>
              ))}
            </ul>
          )}
          {shareText && <ShareResult text={shareText} />}
          <div className="result-actions">
            {/* A replay is an ordinary round, even after the Daily Challenge. */}
            <ClayButton onClick={() => start(current.key, session.answer)}>Play {roundTitle} again</ClayButton>
            <ClayButton variant="soft" onClick={() => dispatch({ type: "reset" })}>
              Choose another round
            </ClayButton>
          </div>
        </ClayCard>
      )}

      {status !== "setup" && isRoute && route && routeFrame && !handingOver && (
        <ClayCard as="section" aria-label="Map" className="map-card">
          <div className="map-stage" ref={mapStageRef}>
            <Suspense fallback={<div className="map-placeholder" />}>
              <SvgMap
                key={session.round}
                frame={routeFrame}
                label={`${nameOf(route.start)} to ${nameOf(route.end)}`}
                theme="Pathfinding"
                regions={regions}
                targets={allCodes}
                named={namedSet}
                highlight={null}
                endpoints={routeEndpoints}
                description={`Map of the route from ${nameOf(route.start)} to ${nameOf(route.end)}: ${guesses.length} ${guesses.length === 1 ? "country" : "countries"} on the route so far.${routeMissed ? ` In red, the ${routeMissed.size} ${routeMissed.size === 1 ? "country" : "countries"} of one shortest route you didn't reach.` : ""}`}
                clickable={mapClickable}
                onCountryClick={onMapClick}
                selected={tip ? mapTap?.code : null}
                missed={routeMissed}
              />
            </Suspense>
            {mapOverlay}
          </div>
          {routeMissed && routeMissed.size > 0 && (
            <p className="map-note map-note--missed">
              <span className="map-key map-key--missed" aria-hidden="true" />
              In red: the rest of one shortest route.
            </p>
          )}
          {mapNote && <p className="map-note">{mapNote}</p>}
          {isPlaying && (
            <div className="give-up-row">
              <ClayButton variant="soft" size="sm" className="give-up" onClick={() => dispatch({ type: "forfeit" })}>
                Give Up
              </ClayButton>
            </div>
          )}
        </ClayCard>
      )}

      {status !== "setup" && current && (
        <ClayCard as="section" aria-label="Map" className="map-card">
          <div className="map-stage" ref={mapStageRef}>
            <Suspense fallback={<div className="map-placeholder" />}>
              <SvgMap
                key={session.round}
                frame={current.key}
                label={current.title}
                theme={current.theme}
                regions={regions}
                targets={session.targetCodes}
                named={namedSet}
                highlight={highlight}
                clickable={mapClickable}
                onCountryClick={onMapClick}
                selected={tip ? mapTap?.code : null}
              />
            </Suspense>
            {mapOverlay}
          </div>
          {mapNote && <p className="map-note">{mapNote}</p>}
        </ClayCard>
      )}

      {status !== "setup" && isRoute && route && !handingOver && (
        <ClayCard as="section" aria-labelledby="route-heading" data-theme="Pathfinding">
          <h2 id="route-heading" className="card-title">
            Your route
          </h2>
          <p className="card-lead">The shortest route has {route.par} countries in between.</p>
          <ol className="raw-list route-list">
            <li className="chip chip--start">
              <span className="chip-name">{nameOf(route.start)}</span>
            </li>
            {guesses.map((g) => (
              <li key={g.country.code} className="chip">
                <span className="chip-name">{g.country.name}</span>
                {g.distance > 0 && <span className="chip-typed">you typed “{g.typed}”</span>}
              </li>
            ))}
            <li className={won ? "chip chip--end chip--end-reached" : "chip chip--end"}>
              <span className="chip-name">{nameOf(route.end)}</span>
            </li>
          </ol>
        </ClayCard>
      )}

      {status !== "setup" && current && (
        <ClayCard as="section" aria-labelledby="named-heading" data-theme={current.theme ?? undefined}>
          <h2 id="named-heading" className="card-title">
            {isCapitals ? "Capitals" : "Countries"} you&apos;ve named
          </h2>
          {guesses.length === 0 ? (
            <p className="empty">Each {isCapitals ? "capital" : "country"} you name lands here.</p>
          ) : (
            <ol className="raw-list">
              {guesses.map((g) => (
                <li key={g.country.code} className="chip" data-region={chipRegion(g.country)}>
                  <span>
                    <span className="chip-name">{g.label ?? g.country.name}</span>
                    <span className="chip-code">{isCapitals ? g.country.name : g.country.code}</span>
                  </span>
                  {g.distance > 0 && <span className="chip-typed">you typed “{g.typed}”</span>}
                </li>
              ))}
            </ol>
          )}
        </ClayCard>
      )}

      </div>
    </>
  );
}
