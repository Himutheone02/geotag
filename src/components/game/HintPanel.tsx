import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";
import type { Country } from "@/utils/fuzzyMatch";

export const MAX_HINTS = 3;

/* ------------------------------------------------------------------ */
/* Hint logic (pure)                                                   */
/* ------------------------------------------------------------------ */

/**
 * Chooses the missing country a hint is about.
 *
 * With `needsBorders` (stage 1), only countries with land borders qualify,
 * since a neighbour list is empty for island nations. Among those, it prefers
 * the country whose neighbour list gives away the fewest *other* answers in
 * this round (neighbours that are in the round and not yet named). Neighbours
 * already named, or outside the round, give nothing away.
 * If no missing country has a land border, any missing country is used.
 */
export function pickHintTarget(
  missing: readonly Country[],
  options: { scope: ReadonlySet<string>; named: ReadonlySet<string>; needsBorders: boolean; random?: () => number },
): Country | null {
  const { scope, named, needsBorders, random = Math.random } = options;
  if (missing.length === 0) return null;

  let pool: readonly Country[] = missing;
  if (needsBorders) {
    const bordered = missing.filter((c) => c.borders.length > 0);
    if (bordered.length > 0) {
      const leaks = (c: Country) => c.borders.filter((b) => scope.has(b) && !named.has(b) && b !== c.code).length;
      const fewest = Math.min(...bordered.map(leaks));
      pool = bordered.filter((c) => leaks(c) === fewest);
    }
  }
  return pool[Math.floor(random() * pool.length)] ?? pool[0];
}

const MINOR_WORDS = new Set(["and", "of", "the"]);

/** "Burkina Faso" -> "B. F.", "São Tomé and Príncipe" -> "S. T. P.", "Guinea-Bissau" -> "G. B." */
export function initialsOf(name: string): string {
  return (
    name
      .split(/[\s-]+/)
      .filter((w) => w && !MINOR_WORDS.has(w.toLowerCase()))
      .map((w) => w[0].toUpperCase() + ".")
      .join(" ") || name[0]
  );
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type HintPanelProps = {
  used: number;
  /** Stage 1 subject, and its land neighbours (resolved to countries). */
  borderTarget: Country | null;
  borderNeighbors: Country[];
  /** Stage 2 subject: the country pulsing on the map. */
  outlineTarget: Country | null;
  named: ReadonlySet<string>;
  /** Countries still missing this round (stage 3 shows their initials). */
  missing: Country[];
  /** Capitals mode: the missing answers are capitals, so the texts and initials are about them. */
  capitals?: boolean;
  onRequest: () => void;
};

/** "Get a hint" button plus the hints revealed so far. Hints build on each other, and each persists for the round. */
export default function HintPanel({
  used,
  borderTarget,
  borderNeighbors,
  outlineTarget,
  named,
  missing,
  capitals = false,
  onRequest,
}: HintPanelProps) {
  const exhausted = used >= MAX_HINTS;
  const answerOf = (c: Country) => (capitals ? (c.capitals[0] ?? c.name) : c.name);
  const initials = used >= 3 ? missing.map((c) => initialsOf(answerOf(c))).sort() : [];
  const subject = capitals ? "A country whose capital is missing" : "A missing country";
  const found = (c: Country) => (capitals ? `${answerOf(c)}, capital of ${c.name}` : c.name);

  return (
    <ClayCard as="section" aria-labelledby="hints-heading" className="hint-card">
      <div className="hint-head">
        <h2 id="hints-heading" className="card-title">
          Hints
        </h2>
        <ClayButton variant="soft" size="sm" onClick={onRequest} disabled={exhausted || missing.length === 0}>
          {exhausted ? `No hints left (${used}/${MAX_HINTS})` : `Get a hint (${used}/${MAX_HINTS})`}
        </ClayButton>
      </div>

      {used === 0 ? (
        <p className="card-lead">Stuck? Each hint goes a step further. You get {MAX_HINTS} per round.</p>
      ) : (
        <ol className="hint-list" aria-live="polite">
          {used >= 1 && borderTarget && (
            <li className="hint">
              {borderNeighbors.length > 0
                ? `${subject} borders ${listNames(borderNeighbors.map((c) => c.name))}.`
                : `${subject} has no land borders: it's an island nation.`}
              {named.has(borderTarget.code) && <span className="hint-found"> You found it: {found(borderTarget)}.</span>}
            </li>
          )}
          {used >= 2 && outlineTarget && (
            <li className="hint">
              {named.has(outlineTarget.code) ? (
                <span className="hint-found">
                  You found the outlined {capitals ? "country's capital" : "country"}: {found(outlineTarget)}.
                </span>
              ) : outlineTarget.code === borderTarget?.code ? (
                "Its outline is pulsing on the map."
              ) : (
                "Another missing country is pulsing on the map."
              )}
            </li>
          )}
          {used >= 3 && (
            <li className="hint">
              {missing.length === 1
                ? `Initials of the last missing ${capitals ? "capital" : "country"}:`
                : `Initials of the ${missing.length} ${capitals ? "capitals " : ""}still missing:`}
              <ul className="initials" aria-label={`Initials of missing ${capitals ? "capitals" : "countries"}`}>
                {initials.map((text, i) => (
                  <li key={`${text}-${i}`} className="initial">
                    {text}
                  </li>
                ))}
              </ul>
              <span className="hint-tap">
                {capitals
                  ? "Tap a country on the map to see its capital's initials."
                  : "Tap a missing country on the map to see its initials."}
              </span>
            </li>
          )}
        </ol>
      )}
    </ClayCard>
  );
}
