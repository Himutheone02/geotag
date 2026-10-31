import type { ReactNode } from "react";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import type { TallyItem } from "@/utils/hintTally";

export { letterCount } from "@/utils/hintTally";

/** Two hints per round, used in order. */
export const MAX_HINTS = 2;

/* ------------------------------------------------------------------ */
/* Hint logic (pure)                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

export type Hint = {
  /** What the hint is called: "Starting Letters", "Capital City", "Reveal Adjacent"... */
  name: string;
  /** What it shows once used. */
  shown: ReactNode;
};

type HintTallyProps = {
  /** "Remaining starting letters" */
  label: string;
  items: readonly TallyItem[];
};

/**
 * A live tally, "Remaining starting letters: M (3), C (1), T (1)", as a row of small clay
 * chips. A chip is keyed by its count too, so the one that just changed springs back in.
 * It isn't a live region of its own: the whole tally is read out once, when the hint is
 * given, and the answer feedback already speaks on every guess.
 */
export function HintTally({ label, items }: HintTallyProps) {
  return (
    <>
      <span className="hint-tally__label">{label}:</span>{" "}
      <ul className="hint-tally" aria-live="off">
        {items.map((item, i) => (
          <li key={`${item.key}:${item.count}`} className="hint-tally__item">
            {item.text}
            {i < items.length - 1 && <span className="visually-hidden">, </span>}
          </li>
        ))}
      </ul>
    </>
  );
}

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
        // New hints are announced; a tally's counts changing inside one isn't.
        <ol className="hint-list" aria-live="polite" aria-relevant="additions">
          {hints.slice(0, used).map((hint) => (
            <li key={hint.name} className="hint">
              <span className="hint-name">{hint.name}</span>
              <div className="hint-text">{hint.shown}</div>
            </li>
          ))}
        </ol>
      )}
    </ClayCard>
  );
}
