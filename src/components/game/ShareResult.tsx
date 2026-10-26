"use client";

import { useState } from "react";
import ClayButton from "@/components/ui/ClayButton";

type ShareResultProps = {
  /** The text to copy: the spoiler-free result, or a challenge link. */
  text: string;
  /** Button label. */
  label?: string;
  /** Shown after a successful copy. */
  copiedMessage?: string;
  /**
   * Show the text: always, never, or only once the button has been pressed.
   * Whatever this says, the text appears if copying fails.
   */
  preview?: boolean | "after-copy";
  /** Accessible name of the shown text. */
  previewLabel?: string;
  variant?: "primary" | "soft";
  size?: "md" | "sm";
};

type CopyState = "idle" | "copied" | "failed";

/**
 * Copies text to the clipboard with `navigator.clipboard.writeText`. If the
 * clipboard isn't available (an http page, a browser that blocks it), the text
 * is shown, selected on click, so the player can copy it by hand.
 */
export default function ShareResult({
  text,
  label = "Share result",
  copiedMessage = "Copied. Paste it anywhere.",
  preview = true,
  previewLabel = "Your result, as it will be shared",
  variant = "primary",
  size = "md",
}: ShareResultProps) {
  const [state, setState] = useState<CopyState>("idle");
  // Bumped on every press so the confirmation re-mounts and replays its spring.
  const [presses, setPresses] = useState(0);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
    setPresses((n) => n + 1);
  }

  const showText = preview === true || state === "failed" || (preview === "after-copy" && state !== "idle");

  return (
    <div className="share">
      {showText && (
        <pre className="share-preview" aria-label={previewLabel}>
          {text}
        </pre>
      )}
      <div className="share-row">
        <ClayButton variant={variant} size={size} className="share-button" onClick={copy}>
          {label}
        </ClayButton>
        <p className="share-status" aria-live="polite">
          {state === "copied" && (
            <span key={presses} className="share-toast">
              {copiedMessage}
            </span>
          )}
          {state === "failed" && (
            <span key={presses} className="share-toast share-toast--failed">
              Couldn&apos;t reach the clipboard. Select the text and copy it.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
