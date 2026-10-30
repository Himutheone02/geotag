import type { ReactNode } from "react";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import type { Country } from "@/utils/fuzzyMatch";

/** Two hints per round, used in order. */
export const MAX_HINTS = 2;

/* ------------------------------------------------------------------ */
/* Hint logic (pure)                                                   */
/* ------------------------------------------------------------------ */

/** A missing country, chosen at random, for a hint to be about. Null when nothing is missing. */
export function pickHintTarget(missing: readonly Country[], random: () => number = Math.random): Country | null {
  if (missing.length === 0) return null;
  return missing[Math.floor(random() * missing.length)] ?? missing[0];
}

/**
 * The first letter and a blank for every other letter: "Brazil" -> "B _ _ _ _ _".
 * Spaces between words stay wider gaps; hyphens and apostrophes stay as they are,
 * so "Guinea-Bissau" -> "G _ _ _ _ _ - _ _ _ _ _ _".
 */
export function letterPattern(name: string): string {
  const words = name.trim().split(/\s+/);
  let first = true;
  return words
    .map((word) =>
      [...word]
        .map((ch) => {
          if (!/\p{L}/u.test(ch)) return ch;
          if (first) {
            first = false;
            return ch.toUpperCase();
          }
          return "_";
        })
        .join(" "),
    )
    .join("   ");
}

/** How many letters a name has (spaces, hyphens and apostrophes don't count). */
export function letterCount(name: string): number {
  return [...name].filter((ch) => /\p{L}/u.test(ch)).length;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export type Hint = {
  /** What the hint is called: "Capital City", "First Letter", "Reveal Adjacent"... */
  name: string;
  /** What it shows once used. */
  shown: ReactNode;
};

type HintPanelProps = {
  /** Hints used so far this round. */
  used: number;
  /** The round's hints, in the order they're given. */
  hints: readonly Hint[];
  /** Shown before the first hint. */
  lead: string;
  /** False when there's nothing left to hint at. */
  available?: boolean;
  onRequest: () => void;
};

/** The hint card: one button that gives the next hint (it says which), and the hints given so far. */
export default function HintPanel({ used, hints, lead, available = true, onRequest }: HintPanelProps) {
  const exhausted = used >= hints.length;
  return (
    <ClayCard as="section" aria-labelledby="hints-heading" className="hint-card">
      <div className="hint-head">
        <h2 id="hints-heading" className="card-title">
          Hints
        </h2>
        <ClayButton variant="soft" size="sm" onClick={onRequest} disabled={exhausted || !available}>
          {exhausted ? `No hints left (${used}/${hints.length})` : `${hints[used].name} (${used}/${hints.length})`}
        </ClayButton>
      </div>

      {used === 0 ? (
        <p className="card-lead">{lead}</p>
      ) : (
        <ol className="hint-list" aria-live="polite">
          {hints.slice(0, used).map((hint) => (
            <li key={hint.name} className="hint">
              <span className="hint-name">{hint.name}</span>
              <span className="hint-text">{hint.shown}</span>
            </li>
          ))}
        </ol>
      )}
    </ClayCard>
  );
}
