// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { PartyResult } from "@/utils/db";
import PartyBoard, { rankParty } from "./PartyBoard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const r = (player: number, timeMs: number, moves: number, won = true): PartyResult => ({
  party: "p",
  route: "FRA-CHN",
  player,
  won,
  timeMs,
  moves,
  finishedAt: player,
});

describe("rankParty", () => {
  it("ranks finishers by time, then moves, then turn; players who gave up come last, in turn order", () => {
    const ranked = rankParty([r(1, 40_000, 6), r(2, 30_000, 9), r(3, 30_000, 5), r(4, 10_000, 2, false), r(5, 30_000, 5), r(6, 5_000, 1, false)]);
    expect(ranked.map((x) => x.player)).toEqual([3, 5, 2, 1, 4, 6]);
  });
});

describe("PartyBoard", () => {
  it("shows rank, player, time and moves, and marks who just played", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<PartyBoard results={[r(1, 72_000, 6), r(2, 41_000, 5), r(3, 9_000, 1, false)]} current={2} />));
    const rows = [...container.querySelectorAll(".party-row")].map((row) =>
      [...row.children].map((c) => c.textContent),
    );
    expect(rows).toEqual([
      ["1", "Player 2just played", "00:41", "5 moves"],
      ["2", "Player 1", "01:12", "6 moves"],
      ["–", "Player 3", "Gave up", "1 move"],
    ]);
    expect(container.querySelector(".party-row[data-current]")!.textContent).toContain("Player 2");
    expect(container.querySelector(".party-row__rank")!.getAttribute("aria-label")).toBe("Rank 1");
    act(() => root.unmount());
  });
});
