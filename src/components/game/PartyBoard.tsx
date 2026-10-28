import type { PartyResult } from "@/utils/db";
import { formatElapsed } from "./Timer";

/**
 * Pass-and-play ranking: everyone who reached the destination, fastest first (fewer moves,
 * then earlier turn, break ties); then everyone who gave up, in turn order, unranked.
 */
export function rankParty(results: readonly PartyResult[]): PartyResult[] {
  const finished = results
    .filter((r) => r.won)
    .sort((a, b) => a.timeMs - b.timeMs || a.moves - b.moves || a.player - b.player);
  const gaveUp = results.filter((r) => !r.won).sort((a, b) => a.player - b.player);
  return [...finished, ...gaveUp];
}

type PartyBoardProps = {
  results: readonly PartyResult[];
  /** The player who just finished, highlighted. */
  current: number | null;
};

/** The party's leaderboard on the route result screen: rank, player, time, moves. */
export default function PartyBoard({ results, current }: PartyBoardProps) {
  const ranked = rankParty(results);
  return (
    <section className="party-board" aria-labelledby="party-board-heading">
      <h3 id="party-board-heading" className="party-board__title">
        Leaderboard
      </h3>
      <ol className="raw-list party-board__list">
        {ranked.map((r, i) => (
          <li
            key={r.player}
            className="party-row"
            data-current={r.player === current || undefined}
            data-gave-up={!r.won || undefined}
          >
            <span className="party-row__rank" aria-label={r.won ? `Rank ${i + 1}` : "Unranked"}>
              {r.won ? i + 1 : "–"}
            </span>
            <span className="party-row__name">
              <span className="party-row__player">Player {r.player}</span>
              {r.player === current && <span className="party-row__you">just played</span>}
            </span>
            <span className="party-row__time">{r.won ? formatElapsed(r.timeMs) : "Gave up"}</span>
            <span className="party-row__moves">{r.moves === 1 ? "1 move" : `${r.moves} moves`}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
