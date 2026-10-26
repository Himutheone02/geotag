"use client";

import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { GameMode } from "@/app/CountryGuesser";
import ClayButton from "@/components/ui/ClayButton";
import { clearRounds, listRounds, summarize, type ModeStats, type RoundRecord } from "@/utils/db";
import type { AnswerKind, Country } from "@/utils/fuzzyMatch";
import { formatElapsed } from "./Timer";

// The same lazily loaded map chunk the game uses (already fetched on the setup screen).
const SvgMap = lazy(() => import("./SvgMap"));

const MODE_LABELS: Record<GameMode, string> = {
  continent: "Continents",
  historical: "Empires",
  world: "World",
  pathfinding: "Pathfinding",
};

type Filter = "all" | "unassisted" | "assisted";
const FILTERS: { filter: Filter; label: string }[] = [
  { filter: "all", label: "All rounds" },
  { filter: "unassisted", label: "Without suggestions" },
  { filter: "assisted", label: "With suggestions" },
];

/** How many rounds the history log shows. */
export const HISTORY_LIMIT = 20;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "42:07" under an hour, "3 h 12 min" from there. */
export function formatPlayTime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes < 60 ? formatElapsed(ms) : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/**
 * The player's local profile: totals, average winning time per mode, personal
 * bests and a log of recent rounds. Everything comes from IndexedDB in this browser.
 */
export default function ProfilePanel({ headingId, countries }: { headingId?: string; countries: Country[] }) {
  // undefined: still loading. null: this browser won't store data.
  const [rounds, setRounds] = useState<RoundRecord[] | null | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    let live = true;
    void listRounds().then((r) => {
      if (live) setRounds(r);
    });
    return () => {
      live = false;
    };
  }, []);

  const filtered = useMemo(
    () => (rounds ?? []).filter((r) => filter === "all" || r.assisted === (filter === "assisted")),
    [rounds, filter],
  );
  const summary = useMemo(() => summarize(filtered), [filtered]);
  const bests = useMemo(() => personalBests(filtered), [filtered]);

  async function clearHistory() {
    if (await clearRounds()) setRounds([]);
    setConfirmingClear(false);
  }

  const heading = (
    <>
      <h2 id={headingId} className="card-title">
        Profile &amp; stats
      </h2>
      <p className="card-lead">Every round you finish or forfeit is saved in this browser, and only here.</p>
    </>
  );

  if (rounds === undefined) {
    return (
      <div className="profile" aria-busy="true">
        {heading}
        <p className="empty">Loading your rounds…</p>
      </div>
    );
  }
  if (rounds === null) {
    return (
      <div className="profile">
        {heading}
        <p className="empty">
          This browser isn&apos;t letting the game store anything (a private window, or site storage turned off), so
          rounds can&apos;t be saved here.
        </p>
      </div>
    );
  }
  if (rounds.length === 0) {
    return (
      <div className="profile">
        {heading}
        <PassportStamps rounds={rounds} />
        <p className="empty">No rounds yet. Finish or forfeit one and it shows up here.</p>
      </div>
    );
  }

  const counts: Record<Filter, number> = {
    all: rounds.length,
    unassisted: rounds.filter((r) => !r.assisted).length,
    assisted: rounds.filter((r) => r.assisted).length,
  };
  const winRate = summary.played ? Math.round((summary.won / summary.played) * 100) : 0;
  const slowest = Math.max(0, ...summary.byMode.map((m) => m.avgWinMs ?? 0));
  const history = filtered.slice(0, HISTORY_LIMIT);

  return (
    <div className="profile">
      {heading}

      {/* Stamps are for good: the filter below doesn't hide them. */}
      <PassportStamps rounds={rounds} />

      <div className="mode-switch profile-filter" role="group" aria-label="Which rounds to include">
        {FILTERS.map(({ filter: f, label }) => (
          <ClayButton
            key={f}
            variant="soft"
            size="sm"
            className="mode-option"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
          >
            {label} <span className="profile-filter__count">{counts[f]}</span>
          </ClayButton>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="empty">
          {filter === "unassisted"
            ? "No rounds without suggestions yet. Switch Suggestions off during a round to play one."
            : "No rounds with suggestions yet."}
        </p>
      ) : (
        <>
          <dl className="stat-tiles">
            <div className="stat-tile">
              <dt>Games played</dt>
              <dd>{summary.played}</dd>
            </div>
            <div className="stat-tile">
              <dt>Rounds won</dt>
              <dd>
                {summary.won} <span className="stat-tile__aside">{winRate}%</span>
              </dd>
            </div>
            <div className="stat-tile">
              <dt>Time played</dt>
              <dd>{formatPlayTime(summary.totalTimeMs)}</dd>
            </div>
          </dl>

          <section className="profile-section" aria-labelledby="mode-times-heading">
            <h3 id="mode-times-heading" className="profile-subtitle">
              Average winning time by mode
            </h3>
            <ul className="mode-bars">
              {summary.byMode.map((m) => (
                <ModeBar key={m.mode} stats={m} slowest={slowest} />
              ))}
            </ul>
          </section>

          <RecallHeatmap rounds={filtered} countries={countries} />

          {bests.length > 0 && (
            <section className="profile-section" aria-labelledby="bests-heading">
              <h3 id="bests-heading" className="profile-subtitle">
                Personal bests
              </h3>
              <ul className="raw-list best-list">
                {bests.map((b) => (
                  <li key={b.roundKey} className="chip best-chip">
                    <span className="chip-name">{b.label}</span>
                    <span className="best-chip__time">{formatElapsed(b.timeMs)}</span>
                    <span className="chip-typed">{plural(b.wins, "win")}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="profile-section" aria-labelledby="history-heading">
            <h3 id="history-heading" className="profile-subtitle">
              Recent rounds
            </h3>
            <ol className="history">
              {history.map((r) => (
                <HistoryRow key={r.id ?? r.finishedAt} round={r} isBest={bests.some((b) => b.id === r.id)} />
              ))}
            </ol>
            {filtered.length > HISTORY_LIMIT && (
              <p className="history-more">
                Showing the latest {HISTORY_LIMIT} of {filtered.length}.
              </p>
            )}
          </section>
        </>
      )}

      <div className="profile-clear">
        {confirmingClear ? (
          <>
            <p className="profile-clear__question" role="alert">
              Delete all {plural(rounds.length, "saved round")}? This can&apos;t be undone.
            </p>
            <ClayButton size="sm" onClick={clearHistory}>
              Delete history
            </ClayButton>
            <ClayButton variant="soft" size="sm" onClick={() => setConfirmingClear(false)}>
              Keep it
            </ClayButton>
          </>
        ) : (
          <ClayButton variant="soft" size="sm" onClick={() => setConfirmingClear(true)}>
            Clear history
          </ClayButton>
        )}
      </div>
    </div>
  );
}

function ModeBar({ stats, slowest }: { stats: ModeStats; slowest: number }) {
  const label = MODE_LABELS[stats.mode];
  const { avgWinMs, won, played } = stats;
  let note: string;
  if (played === 0) note = "Not played yet";
  else if (avgWinMs === null) note = `No wins yet, ${plural(played, "round")} played`;
  else {
    const rate =
      stats.mode === "pathfinding"
        ? stats.movesOverPar === 0
          ? "every route the shortest way"
          : `${stats.movesOverPar!.toFixed(1)} moves over the shortest route`
        : `${stats.secondsPerCountry!.toFixed(1)} s per country`;
    note = `${rate} · ${won} of ${plural(played, "round")} won`;
  }
  const fraction = avgWinMs === null || slowest === 0 ? 0 : avgWinMs / slowest;

  return (
    <li className="mode-bar">
      <span className="mode-bar__label">{label}</span>
      <span className="mode-bar__track" aria-hidden="true">
        {avgWinMs !== null && (
          <span className="mode-bar__fill" style={{ "--fill": `${Math.max(fraction * 100, 4)}%` } as CSSProperties} />
        )}
      </span>
      <span className="mode-bar__value">{avgWinMs === null ? "–" : formatElapsed(avgWinMs)}</span>
      <span className="mode-bar__note">{note}</span>
    </li>
  );
}

function HistoryRow({ round: r, isBest }: { round: RoundRecord; isBest: boolean }) {
  const won = r.result === "won";
  const progress =
    r.mode === "pathfinding"
      ? won
        ? `${plural(r.moves ?? 0, "move")}, shortest ${r.par}`
        : `forfeited after ${plural(r.moves ?? 0, "move")}`
      : `${r.correct}/${r.target} named`;
  const details = [progress, plural(r.guesses, "guess", "guesses")];
  if (r.mode !== "pathfinding") details.push(r.hintsUsed === 0 ? "no hints" : plural(r.hintsUsed, "hint"));

  return (
    <li className="history-row">
      <div className="history-row__main">
        <span className="history-row__label">{r.label}</span>
        <span className="history-row__meta">
          {MODE_LABELS[r.mode]} · {details.join(" · ")}
        </span>
        <span className="history-row__tags">
          <span className={won ? "tag tag--won" : "tag tag--lost"}>{won ? "Won" : "Forfeited"}</span>
          {r.daily && <span className="tag tag--daily">Daily</span>}
          {isBest && <span className="tag tag--best">Best</span>}
          {r.assisted && <span className="tag">Suggestions</span>}
        </span>
      </div>
      <div className="history-row__side">
        <span className="history-row__time">{formatElapsed(r.timeMs)}</span>
        <time className="history-row__date" dateTime={new Date(r.finishedAt).toISOString()}>
          {dateFormat.format(r.finishedAt)}
        </time>
      </div>
    </li>
  );
}

type Best = { id: number | undefined; roundKey: string; label: string; mode: GameMode; timeMs: number; wins: number };

/** Fastest win for each continent, empire and World round. Routes are random, so they have no bests. */
export function personalBests(rounds: readonly RoundRecord[]): Best[] {
  const byKey = new Map<string, Best>();
  for (const r of rounds) {
    if (r.result !== "won" || r.mode === "pathfinding") continue;
    const prev = byKey.get(r.roundKey);
    if (!prev) byKey.set(r.roundKey, { id: r.id, roundKey: r.roundKey, label: r.label, mode: r.mode, timeMs: r.timeMs, wins: 1 });
    else {
      prev.wins++;
      if (r.timeMs < prev.timeMs) Object.assign(prev, { id: r.id, timeMs: r.timeMs });
    }
  }
  const order: GameMode[] = ["continent", "historical", "world", "pathfinding"];
  return [...byKey.values()].sort((a, b) => order.indexOf(a.mode) - order.indexOf(b.mode) || a.label.localeCompare(b.label));
}

/* ------------------------------------------------------------------ */
/* Recall heatmap                                                      */
/* ------------------------------------------------------------------ */

/** A hinted answer counts as at least this many seconds in a country's average. */
export const HINT_PENALTY_SECONDS = 30;

/**
 * Green (fast) to red (slow), as asked, with lightness falling at every step so the
 * order still reads for red-green color-blind players and in grayscale (dataviz
 * validator: monotone lightness, adjacent steps >= 0.06 apart, lightest >= 2:1 on the map).
 */
export const RECALL_BANDS = [
  { max: 4, label: "Under 4 s", color: "#3cc96a" },
  { max: 10, label: "4–10 s", color: "#aa8f13" },
  { max: 20, label: "10–20 s", color: "#b45c03" },
  { max: Infinity, label: "Over 20 s", color: "#a71f2d" },
] as const;

export type RecallStat = { code: string; seconds: number; answers: number; hinted: number };

/**
 * Average recall time per country across saved list rounds of one kind (countries or
 * capitals): the time from the previous answer to this one. Hinted answers count as at
 * least HINT_PENALTY_SECONDS. Answers picked from the suggestion list are recognition,
 * not recall, so they're left out. Fastest first.
 */
export function recallStats(rounds: readonly RoundRecord[], answer: AnswerKind = "countries"): RecallStat[] {
  const totals = new Map<string, { seconds: number; answers: number; hinted: number }>();
  for (const r of rounds) {
    if (!r.answers || (r.answer ?? "countries") !== answer) continue;
    for (const a of r.answers) {
      if (a.picked) continue;
      const seconds = a.hinted ? Math.max(a.ms / 1000, HINT_PENALTY_SECONDS) : a.ms / 1000;
      const t = totals.get(a.code) ?? { seconds: 0, answers: 0, hinted: 0 };
      t.seconds += seconds;
      t.answers++;
      if (a.hinted) t.hinted++;
      totals.set(a.code, t);
    }
  }
  return [...totals]
    .map(([code, t]) => ({ code, seconds: t.seconds / t.answers, answers: t.answers, hinted: t.hinted }))
    .sort((a, b) => a.seconds - b.seconds || (a.code < b.code ? -1 : 1));
}

export function recallBand(seconds: number): number {
  return RECALL_BANDS.findIndex((b) => seconds <= b.max);
}

const NOTHING: ReadonlySet<string> = new Set();

function RecallHeatmap({ rounds, countries }: { rounds: readonly RoundRecord[]; countries: Country[] }) {
  const [kind, setKind] = useState<AnswerKind>("countries");
  const hasCapitals = rounds.some((r) => r.answer === "capitals" && r.answers?.length);
  const shownKind = hasCapitals ? kind : "countries";
  const stats = useMemo(() => recallStats(rounds, shownKind), [rounds, shownKind]);
  const byCode = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries]);
  const targets = useMemo(() => countries.map((c) => c.code), [countries]);
  const regions = useMemo(() => Object.fromEntries(countries.map((c) => [c.code, c.region])), [countries]);
  const nameOf = (code: string) => {
    const c = byCode.get(code);
    if (!c) return code;
    return shownKind === "capitals" ? `${c.capitals[0] ?? c.name} (${c.name})` : c.name;
  };
  const describe = (s: RecallStat) =>
    `${s.seconds.toFixed(1)} s on average, ${plural(s.answers, "time")}` + (s.hinted ? `, ${s.hinted} with a hint` : "");
  const fills = useMemo(
    () =>
      Object.fromEntries(
        stats.map((s) => [s.code, { color: RECALL_BANDS[recallBand(s.seconds)].color, title: `${nameOf(s.code)}: ${describe(s)}` }]),
      ),
    // nameOf only reads byCode and shownKind.
    [stats, byCode, shownKind],
  );
  const perBand = RECALL_BANDS.map((_, i) => stats.filter((s) => recallBand(s.seconds) === i).length);
  // Two lists that never overlap: with 5 or fewer timed, one list, slowest first.
  const lists =
    stats.length > 5
      ? [
          { title: "Slowest to recall", items: stats.slice(Math.max(5, stats.length - 5)).reverse() },
          { title: "Fastest", items: stats.slice(0, 5) },
        ]
      : [{ title: "Timed so far", items: [...stats].reverse() }];

  return (
    <section className="profile-section" aria-labelledby="heatmap-heading">
      <h3 id="heatmap-heading" className="profile-subtitle">
        Recall speed by country
      </h3>
      <p className="profile-note">
        How long each country takes you to come up with, from your previous answer, averaged over your continent,
        empire and World rounds. A hinted answer counts as at least {HINT_PENALTY_SECONDS} s; answers picked from the
        suggestion list don&apos;t count.
      </p>
      {hasCapitals && (
        <div className="mode-switch heatmap-switch" role="group" aria-label="Which answers to map">
          {(["countries", "capitals"] as const).map((k) => (
            <ClayButton key={k} variant="soft" size="sm" className="mode-option" aria-pressed={shownKind === k} onClick={() => setKind(k)}>
              {k === "countries" ? "Countries" : "Capitals"}
            </ClayButton>
          ))}
        </div>
      )}
      <div className="heatmap">
        <Suspense fallback={<div className="map-placeholder" />}>
          <SvgMap
            frame="World"
            label="Recall speed"
            theme={null}
            regions={regions}
            targets={targets}
            named={NOTHING}
            highlight={null}
            fills={fills}
            description={`World map of your recall speed: ${plural(stats.length, "country", "countries")} timed, colored from green (fast) to red (slow).`}
          />
        </Suspense>
      </div>
      <ul className="heat-legend" aria-label="Map legend">
        {RECALL_BANDS.map((band, i) => (
          <li key={band.label}>
            <span className="heat-swatch" style={{ background: band.color }} aria-hidden="true" />
            {band.label} <span className="heat-legend__count">{perBand[i]}</span>
          </li>
        ))}
        <li>
          <span className="heat-swatch heat-swatch--blank" aria-hidden="true" />
          Not named yet <span className="heat-legend__count">{countries.length - stats.length}</span>
        </li>
      </ul>
      {stats.length === 0 ? (
        <p className="empty">No timed answers yet. Type your answers in a continent, empire or World round to fill the map.</p>
      ) : (
        <div className="heat-lists">
          {lists.map((list) => (
            <div key={list.title}>
              <h4 className="heat-lists__title">{list.title}</h4>
              <ol className="heat-list">
                {list.items.map((s) => (
                  <li key={s.code}>
                    <span className="heat-swatch" style={{ background: RECALL_BANDS[recallBand(s.seconds)].color }} aria-hidden="true" />
                    <span className="heat-list__name">{nameOf(s.code)}</span>
                    <span className="heat-list__value">{s.seconds.toFixed(1)} s</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Passport stamps (achievements)                                      */
/* ------------------------------------------------------------------ */

export type Stamp = {
  id: "roman-emperor" | "speedrunner" | "world-traveler";
  name: string;
  requirement: string;
  /** Lettering pressed into the token. */
  mark: string;
  earnedBy: (r: RoundRecord) => boolean;
};

/** Seconds per country a continent round must beat for Speedrunner. */
export const SPEEDRUN_SECONDS = 3;
/** Speedrunner needs a continent of more than this many countries: Africa, the Americas, Asia or Europe, not Oceania. */
export const SPEEDRUN_MIN_COUNTRIES = 30;

export const STAMPS: readonly Stamp[] = [
  {
    id: "roman-emperor",
    name: "Roman Emperor",
    requirement: "Complete the Roman Empire with no hints and suggestions off.",
    mark: "SPQR",
    earnedBy: (r) =>
      r.mode === "historical" && r.roundKey.split(":")[0] === "Roman" && r.result === "won" && r.hintsUsed === 0 && !r.assisted,
  },
  {
    id: "speedrunner",
    name: "Speedrunner",
    requirement: `Complete Africa, the Americas, Asia or Europe averaging under ${SPEEDRUN_SECONDS} s per country, with suggestions off.`,
    mark: "3s",
    earnedBy: (r) =>
      r.mode === "continent" &&
      r.result === "won" &&
      !r.assisted &&
      r.target > SPEEDRUN_MIN_COUNTRIES &&
      r.timeMs / 1000 / r.target < SPEEDRUN_SECONDS,
  },
  {
    id: "world-traveler",
    name: "World Traveler",
    requirement: "Play a World round.",
    mark: "195",
    earnedBy: (r) => r.mode === "world",
  },
];

/** Each stamp, with when it was first earned (null: not yet). */
export function stampProgress(rounds: readonly RoundRecord[]): { stamp: Stamp; earnedAt: number | null }[] {
  return STAMPS.map((stamp) => {
    const times = rounds.filter(stamp.earnedBy).map((r) => r.finishedAt);
    return { stamp, earnedAt: times.length ? Math.min(...times) : null };
  });
}

const stampDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function PassportStamps({ rounds }: { rounds: readonly RoundRecord[] }) {
  const progress = useMemo(() => stampProgress(rounds), [rounds]);
  const earned = progress.filter((p) => p.earnedAt !== null).length;
  return (
    <section className="profile-section" aria-labelledby="stamps-heading">
      <h3 id="stamps-heading" className="profile-subtitle">
        Passport stamps <span className="profile-subtitle__aside">{earned} of {STAMPS.length}</span>
      </h3>
      <ul className="stamps">
        {progress.map(({ stamp, earnedAt }) => (
          <li key={stamp.id} className={earnedAt ? "stamp-slot stamp-slot--earned" : "stamp-slot"} data-stamp={stamp.id}>
            {/* A plastic token when earned; until then, the empty impression it will sit in. */}
            <span className="stamp" aria-hidden="true">
              <span className="stamp__face">
                <span className="stamp__mark">{stamp.mark}</span>
              </span>
            </span>
            <span className="stamp-name">{stamp.name}</span>
            <span className="stamp-status">
              {earnedAt ? (
                `Earned ${stampDate.format(earnedAt)}`
              ) : (
                <>
                  <span className="visually-hidden">Not earned yet. </span>
                  {stamp.requirement}
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
