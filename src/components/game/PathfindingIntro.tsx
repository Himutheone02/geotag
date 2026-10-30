"use client";

import { useEffect, useRef, useState } from "react";
import ClayButton from "@/components/ui/ClayButton";
import ClayCard from "@/components/ui/ClayCard";

/** The three cards, in order. Exported for tests. */
export const INTRO_CARDS = [
  {
    title: "Build from both ends",
    text: "Name any country that borders your start, your destination, or a country you've already named. Grow the route from both ends until they meet.",
  },
  {
    title: "The map is in fog",
    text: "Only your start (violet) and destination (gold) show at first. Borders appear as you name countries. Stuck? Reveal Adjacent outlines what borders your route; Reveal All lifts the fog.",
  },
  {
    title: "Every guess is a move",
    text: "Dead ends count too. Each guess turns green on a shortest route, yellow one country off it, red off course. The Daily Pathfinding allows the shortest route plus 4 guesses.",
  },
] as const;

type PathfindingIntroProps = {
  /** The player finished or dismissed the cards: start the route. */
  onDone: () => void;
};

/**
 * Shown once, before a player's very first Pathfinding round (the timer hasn't started):
 * three short cards on the free-roam rules and the fog. Next / Back step through them; Skip,
 * Escape or the last card's button closes them. The caller saves that they were seen.
 * A native modal <dialog>, like Profile & Stats.
 */
export default function PathfindingIntro({ onDone }: PathfindingIntroProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState(0);
  const card = INTRO_CARDS[step];
  const last = step === INTRO_CARDS.length - 1;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="profile-dialog intro-dialog"
      aria-labelledby="intro-heading"
      aria-describedby="intro-text"
      onCancel={(e) => {
        e.preventDefault();
        onDone();
      }}
    >
      <ClayCard as="section" className="intro-card" key={step}>
        <div className="intro-card__bar">
          <p className="intro-card__step">
            Pathfinding · {step + 1} of {INTRO_CARDS.length}
          </p>
          <ClayButton variant="soft" size="sm" onClick={onDone}>
            Skip
          </ClayButton>
        </div>
        <h2 id="intro-heading" className="card-title">
          {card.title}
        </h2>
        <p id="intro-text" className="card-lead">
          {card.text}
        </p>
        <div className="intro-card__dots" aria-hidden="true">
          {INTRO_CARDS.map((c, i) => (
            <span key={c.title} className="intro-card__dot" data-current={i === step || undefined} />
          ))}
        </div>
        <div className="intro-card__actions">
          {step > 0 && (
            <ClayButton variant="soft" onClick={() => setStep(step - 1)}>
              Back
            </ClayButton>
          )}
          <ClayButton onClick={() => (last ? onDone() : setStep(step + 1))} autoFocus>
            {last ? "Start the route" : "Next"}
          </ClayButton>
        </div>
      </ClayCard>
    </dialog>
  );
}
