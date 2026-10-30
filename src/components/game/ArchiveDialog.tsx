"use client";

import { useEffect, useRef, useState } from "react";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import { countsAsPlayed, listDailies, listRounds } from "@/utils/db";
import { DAILY_RULES_SINCE, type DailyKind } from "@/utils/dailySeed";
import { DAILY_TITLES, longDate } from "./DailyCard";

/** One past date and its two puzzles, described without giving anything away. */
export type ArchiveDay = {
  date: string;
  /** Daily Guessing's round: "Asia", "Roman Empire". */
  guessing: string;
  /** Daily Pathfinding's ends, by name, or null if that date had no route. */
  pathfinding: { start: string; end: string } | null;
};

type ArchiveDialogProps = {
  days: readonly ArchiveDay[];
  onPlay: (kind: DailyKind, date: string) => void;
  onClose: () => void;
};

/** "October 30", from a YYYY-MM-DD key. */
function dayAndMonth(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

/** "October 2026", from a YYYY-MM-DD key. */
function monthOf(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/**
 * Daily Archive: every past date's two puzzles, to replay offline (every puzzle comes from
 * its date's seed, so nothing is fetched). A replay is an ordinary round: it isn't saved as
 * that day's daily and never counts toward a streak. A check marks the ones already played,
 * live or from here. A native modal <dialog>, like Profile & Stats.
 */
export default function ArchiveDialog({ days, onPlay, onClose }: ArchiveDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // "guessing:2026-10-28" for each puzzle played, live or from the archive.
  const [played, setPlayed] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let live = true;
    void Promise.all([listDailies("guessing"), listDailies("pathfinding"), listRounds()]).then(([guessing, pathfinding, rounds]) => {
      if (!live) return;
      const done = new Set<string>();
      for (const r of [...(guessing ?? []), ...(pathfinding ?? [])]) done.add(`${r.kind}:${r.date}`);
      // The same bar as a daily: an empty give-up (nothing named, no move) isn't a play.
      for (const r of rounds ?? []) {
        if (!r.archive) continue;
        const kind: DailyKind = r.mode === "pathfinding" ? "pathfinding" : "guessing";
        if (countsAsPlayed({ kind, result: r.result, correct: r.correct, moves: r.moves ?? 0 })) done.add(`${kind}:${r.archive}`);
      }
      setPlayed(done);
    });
    return () => {
      live = false;
    };
  }, []);

  const months: { month: string; days: ArchiveDay[] }[] = [];
  for (const day of days) {
    const month = monthOf(day.date);
    if (months.at(-1)?.month !== month) months.push({ month, days: [] });
    months.at(-1)!.days.push(day);
  }
  const redealt = days.some((d) => d.date < DAILY_RULES_SINCE);

  const puzzle = (kind: DailyKind, date: string, what: string) => {
    const done = played.has(`${kind}:${date}`);
    return (
      <ClayButton
        variant="soft"
        size="sm"
        className="archive-puzzle"
        data-kind={kind}
        data-played={done || undefined}
        onClick={() => onPlay(kind, date)}
        aria-label={`${DAILY_TITLES[kind]}, ${longDate(date)}: ${what}${done ? " (played)" : ""}`}
      >
        <span className="archive-puzzle__kind">{kind === "guessing" ? "Guessing" : "Pathfinding"}</span>
        <span className="archive-puzzle__what">{what}</span>
        {done && (
          <span className="archive-puzzle__done" aria-hidden="true">
            ✓
          </span>
        )}
      </ClayButton>
    );
  };

  return (
    <dialog
      ref={ref}
      className="profile-dialog archive-dialog"
      aria-labelledby="archive-heading"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <ClayCard as="section" className="profile-modal archive-modal">
        <div className="profile-modal__bar">
          <ClayButton variant="soft" size="sm" onClick={onClose} autoFocus>
            Close
          </ClayButton>
        </div>
        <h2 id="archive-heading" className="card-title">
          Daily Archive
        </h2>
        <p className="card-lead">
          Replay any past day&apos;s puzzles, even offline. Replays don&apos;t count toward your streaks; Daily Pathfinding
          keeps its guess limit.
        </p>
        {redealt && (
          <p className="archive-note">
            Before {dayAndMonth(DAILY_RULES_SINCE)}, the dailies were dealt by earlier rules: those
            dates show what today&apos;s rules deal for them, which may differ from what was live.
          </p>
        )}
        {days.length === 0 ? (
          <p className="empty">Nothing here yet: today&apos;s puzzles join the archive at midnight.</p>
        ) : (
          months.map(({ month, days: inMonth }) => (
            <section key={month} className="archive-month" aria-label={month}>
              <h3 className="archive-month__title">{month}</h3>
              <ol className="archive-days">
                {inMonth.map((day) => (
                  <li key={day.date} className="archive-day">
                    <p className="archive-day__date">{longDate(day.date)}</p>
                    <div className="archive-day__puzzles">
                      {puzzle("guessing", day.date, day.guessing)}
                      {day.pathfinding && puzzle("pathfinding", day.date, `${day.pathfinding.start} → ${day.pathfinding.end}`)}
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </ClayCard>
    </dialog>
  );
}
