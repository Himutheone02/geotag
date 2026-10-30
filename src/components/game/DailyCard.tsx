"use client";

import { useEffect, useState, type ReactNode } from "react";
import { nextLocalMidnight } from "@/utils/dailySeed";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import { dailyStats, listDailies, type DailyRecord } from "@/utils/db";
import type { DailyChallenge, DailyKind } from "@/utils/dailySeed";
import ShareResult from "./ShareResult";
import { formatElapsed } from "./Timer";

export const DAILY_TITLES: Record<DailyKind, string> = {
  guessing: "Daily Guessing",
  pathfinding: "Daily Pathfinding",
};

type DailyCardProps<C extends string> = {
  challenge: DailyChallenge<C>;
  /** What today's puzzle is, in a sentence: "Name all 54 countries in Africa." */
  lead: ReactNode;
  /** Starts this daily. `replay`: today's result is already saved, so this play won't count. */
  onPlay: (replay: boolean) => void;
  /** Told whether today's puzzle has been played, once the profile is read. Must be stable. */
  onStatus?: (kind: DailyKind, playedToday: boolean) => void;
};

/** "Thursday, October 29", from a YYYY-MM-DD key, in the player's language. */
export function longDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/** "54/54 in 05:12", "6 moves in 01:12", "gave up after 6 moves". */
export function dailyOutcome(record: DailyRecord): string {
  if (record.kind === "pathfinding") {
    const moves = `${record.moves} ${record.moves === 1 ? "move" : "moves"}`;
    if (record.result === "won") return `${moves} in ${formatElapsed(record.timeMs)}`;
    return record.outOfGuesses ? `out of guesses after ${moves}` : `gave up after ${moves}`;
  }
  return `${record.correct}/${record.target} in ${formatElapsed(record.timeMs)}${record.result === "won" ? "" : " (gave up)"}`;
}

/**
 * One Daily Challenge on the setup screen: what today's puzzle is, the player's stats for
 * this daily (played, completed, streaks), and once today's is played, its first result and
 * share text. Each daily keeps its own records, in the dailies store.
 */
export default function DailyCard<C extends string>({ challenge, lead, onPlay, onStatus }: DailyCardProps<C>) {
  const { kind, date } = challenge;
  // undefined: still reading the profile. null: storage unavailable.
  const [records, setRecords] = useState<DailyRecord[] | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void listDailies(kind).then((list) => {
      if (live) setRecords(list);
    });
    return () => {
      live = false;
    };
  }, [kind, date]);

  const today = records?.find((r) => r.date === date) ?? null;
  const stats = records ? dailyStats(records, date) : null;
  const playedToday = today !== null;
  useEffect(() => {
    if (records !== undefined) onStatus?.(kind, playedToday);
  }, [records, playedToday, kind, onStatus]);
  const headingId = `daily-${kind}-heading`;

  return (
    <ClayCard as="section" className="daily-card" data-kind={kind} aria-labelledby={headingId}>
      <div className="daily-card__text">
        <h3 id={headingId} className="card-title">
          {DAILY_TITLES[kind]}
        </h3>
        <p className="card-lead">{lead}</p>
        {today && <p className="daily-card__done">Done today: {dailyOutcome(today)}.</p>}
        {stats && stats.played > 0 && (
          <dl className="daily-stats" aria-label={`${DAILY_TITLES[kind]} stats`}>
            <div>
              <dt>Played</dt>
              <dd>{stats.played}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>{stats.won}</dd>
            </div>
            <div>
              <dt>Streak</dt>
              <dd>{stats.streak}</dd>
            </div>
            <div>
              <dt>Best</dt>
              <dd>{stats.bestStreak}</dd>
            </div>
          </dl>
        )}
      </div>
      <div className="daily-card__actions">
        <ClayButton onClick={() => onPlay(today !== null)} disabled={records === undefined}>
          {today ? "Play again" : "Play"}
        </ClayButton>
        {today?.share && <ShareResult text={today.share} preview={false} size="sm" />}
      </div>
    </ClayCard>
  );
}

/** "7 h 12 min", "45 min", "3 h": time left, rounded up to the minute so it never says 0. */
export function formatCountdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** How often the countdown redraws. It shows minutes, so this is plenty. */
export const COUNTDOWN_TICK_MS = 15_000;

/**
 * "New puzzles in 7 h 12 min": shown once both of today's dailies are played, counting down
 * to local midnight, when both unlock (the setup screen rolls over by itself then).
 */
export function MidnightCountdown() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return (
    <p className="dailies__countdown" role="timer" aria-label="Time until the next puzzles">
      <span className="dailies__countdown-label">Both done. New puzzles in</span>{" "}
      <strong className="dailies__countdown-time">{formatCountdown(nextLocalMidnight(now) - now)}</strong>
    </p>
  );
}
