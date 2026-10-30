"use client";

import { useEffect, useState } from "react";
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
  /** Display name of a country code (route endpoints). */
  nameOf: (code: string) => string;
  /** Starts this daily. `replay`: today's result is already saved, so this play won't count. */
  onPlay: (replay: boolean) => void;
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
    return record.result === "won" ? `${moves} in ${formatElapsed(record.timeMs)}` : `gave up after ${moves}`;
  }
  return `${record.correct}/${record.target} in ${formatElapsed(record.timeMs)}${record.result === "won" ? "" : " (gave up)"}`;
}

/**
 * One Daily Challenge on the setup screen: what today's puzzle is, the player's stats for
 * this daily (played, completed, streaks), and once today's is played, its first result and
 * share text. Each daily keeps its own records, in the dailies store.
 */
export default function DailyCard<C extends string>({ challenge, nameOf, onPlay }: DailyCardProps<C>) {
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
  const headingId = `daily-${kind}-heading`;
  const what =
    challenge.kind === "pathfinding" ? (
      <>
        Connect <strong>{nameOf(challenge.puzzle.start)}</strong> and <strong>{nameOf(challenge.puzzle.end)}</strong>: the
        shortest route has {challenge.puzzle.par} countries in between.
      </>
    ) : (
      <>
        Name every country in {challenge.continent === "Americas" && "the "}
        <strong>{challenge.continent}</strong>.
      </>
    );

  return (
    <ClayCard as="section" className="daily-card" data-kind={kind} aria-labelledby={headingId}>
      <div className="daily-card__text">
        <h3 id={headingId} className="card-title">
          {DAILY_TITLES[kind]}
        </h3>
        <p className="card-lead">{what}</p>
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
