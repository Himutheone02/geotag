"use client";

import { useEffect, useState } from "react";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import { listRounds, type RoundRecord } from "@/utils/db";
import type { DailyChallenge } from "@/utils/dailySeed";
import ShareResult from "./ShareResult";
import { formatElapsed } from "./Timer";

type DailyCardProps<C extends string> = {
  challenge: DailyChallenge<C>;
  /** Starts today's challenge. `replay`: today's result is already saved, so this play won't count as the daily. */
  onPlay: (replay: boolean) => void;
};

/** "Monday, October 26", from a YYYY-MM-DD key, in the player's language. */
function longDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/**
 * The setup screen's Daily Challenge: what today's puzzle is, and once it has
 * been played, the first result and its share text.
 */
export default function DailyCard<C extends string>({ challenge, onPlay }: DailyCardProps<C>) {
  // undefined: still checking the profile. null: not played today (or nothing saved).
  const [result, setResult] = useState<RoundRecord | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void listRounds().then((rounds) => {
      if (!live) return;
      const today = (rounds ?? []).filter((r) => r.daily === challenge.date).sort((a, b) => a.finishedAt - b.finishedAt);
      setResult(today[0] ?? null);
    });
    return () => {
      live = false;
    };
  }, [challenge.date]);

  const what =
    challenge.kind === "pathfinding"
      ? `A land route with ${challenge.puzzle.par} countries in between.`
      : `Every country in ${challenge.continent}.`;
  const outcome =
    result &&
    (result.mode === "pathfinding"
      ? result.result === "won"
        ? `${result.moves} moves in ${formatElapsed(result.timeMs)}`
        : `gave up after ${result.moves} moves`
      : `${result.correct}/${result.target} in ${formatElapsed(result.timeMs)}`);

  return (
    <ClayCard as="section" className="daily-card setup-only" aria-labelledby="daily-heading">
      <div className="daily-card__text">
        <p className="daily-card__date">{longDate(challenge.date)}</p>
        <h2 id="daily-heading" className="card-title">
          Daily Challenge
        </h2>
        <p className="card-lead">{what} The same puzzle for everyone today.</p>
        {result && <p className="daily-card__done">Done today: {outcome}.</p>}
      </div>
      <div className="daily-card__actions">
        <ClayButton onClick={() => onPlay(Boolean(result))} disabled={result === undefined}>
          {result ? "Play again" : "Play today's challenge"}
        </ClayButton>
        {result?.share && <ShareResult text={result.share} preview={false} size="sm" />}
      </div>
    </ClayCard>
  );
}
