"use client";

import { useEffect, useId, useState, type ComponentProps, type KeyboardEvent } from "react";
import ClayCard from "./ClayCard";

export type ClayInputOption = {
  /** Stable identity (a country code). */
  key: string;
  label: string;
  /** Smaller second line, e.g. the alternate name that matched. */
  detail?: string;
};

type ClayInputProps = ComponentProps<"input"> & {
  /** Accessible name. Always rendered; visually hidden when hideLabel is set. */
  label: string;
  hideLabel?: boolean;
  /** Class for the wrapping field (label + input). */
  fieldClassName?: string;
  /**
   * Autocomplete options. When given, the field becomes a combobox with a
   * floating list below it. Pass a memoized array: a new array identity
   * resets the keyboard selection.
   */
  suggestions?: readonly ClayInputOption[];
  /** Called when an option is clicked, or chosen with the arrow keys and Enter. */
  onPickSuggestion?: (option: ClayInputOption) => void;
};

/** How long the list's exit spring plays before it unmounts. Matches .clay-suggest--closing. */
export const SUGGEST_EXIT_MS = 240;

const NO_OPTIONS: readonly ClayInputOption[] = [];

type Shown = { items: readonly ClayInputOption[]; closing: boolean };

/**
 * Extruded clay text field with its label, and an optional autocomplete list.
 * `ref` (React 19 ref-as-prop) and all other input props pass through to the <input>.
 *
 * Keyboard: Down/Up move through the list, Enter picks the highlighted option
 * (with nothing highlighted, Enter submits the form as usual), Escape closes it.
 */
export default function ClayInput({
  label,
  hideLabel = false,
  id,
  className,
  fieldClassName,
  suggestions,
  onPickSuggestion,
  onKeyDown,
  onFocus,
  onBlur,
  onChange,
  ...rest
}: ClayInputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listId = `${inputId}-list`;
  const optionId = (i: number) => `${inputId}-opt-${i}`;
  const isCombobox = suggestions !== undefined;
  const items = suggestions ?? NO_OPTIONS;

  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);
  const [shown, setShown] = useState<Shown | null>(null);
  const [lastItems, setLastItems] = useState(items);

  const open = isCombobox && focused && !dismissed && items.length > 0;

  // Adjusting state while rendering (instead of in an effect) avoids a frame
  // where the new list shows with the old highlight.
  if (lastItems !== items) {
    setLastItems(items);
    setActive(-1);
  }
  if (open && (shown === null || shown.closing || shown.items !== items)) {
    setShown({ items, closing: false });
  } else if (!open && shown && !shown.closing) {
    // Keep the last list on screen while its exit spring plays.
    setShown({ items: shown.items, closing: true });
  }

  useEffect(() => {
    if (!shown?.closing) return;
    const timer = setTimeout(() => setShown(null), SUGGEST_EXIT_MS);
    return () => clearTimeout(timer);
  }, [shown]);

  function pick(option: ClayInputOption) {
    setActive(-1);
    onPickSuggestion?.(option);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    onKeyDown?.(e);
    if (e.defaultPrevented || !isCombobox) return;
    const n = items.length;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        if (n === 0) return;
        e.preventDefault();
        if (!open) {
          setDismissed(false);
          setActive(e.key === "ArrowDown" ? 0 : n - 1);
          return;
        }
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => (i === -1 ? (step === 1 ? 0 : n - 1) : (i + step + n) % n));
        return;
      }
      case "Enter":
        if (open && active >= 0 && active < n) {
          e.preventDefault(); // pick instead of submitting the form
          pick(items[active]);
        }
        return;
      case "Escape":
        if (open) {
          e.preventDefault();
          setDismissed(true);
          setActive(-1);
        }
        return;
    }
  }

  const activeId = open && active >= 0 ? optionId(active) : undefined;

  return (
    <div className={["clay-field", fieldClassName].filter(Boolean).join(" ")}>
      <label htmlFor={inputId} className={hideLabel ? "visually-hidden" : "clay-field__label"}>
        {label}
      </label>
      <input
        id={inputId}
        className={["clay-input", className].filter(Boolean).join(" ")}
        {...(isCombobox && {
          role: "combobox",
          "aria-autocomplete": "list" as const,
          "aria-expanded": open,
          "aria-controls": listId,
          "aria-activedescendant": activeId,
        })}
        onKeyDown={handleKeyDown}
        onChange={(e) => {
          setDismissed(false); // typing brings a dismissed list back
          onChange?.(e);
        }}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          setDismissed(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {isCombobox && shown && (
        <ClayCard
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          aria-hidden={shown.closing || undefined}
          className={shown.closing ? "clay-suggest clay-suggest--closing" : "clay-suggest"}
        >
          {shown.items.map((option, i) => (
            <div
              key={option.key}
              id={shown.closing ? undefined : optionId(i)}
              role="option"
              aria-selected={!shown.closing && i === active}
              className="clay-suggest__option"
              // Keep focus (and the on-screen keyboard) in the input.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => !shown.closing && pick(option)}
            >
              <span className="clay-suggest__label">{option.label}</span>
              {option.detail && <span className="clay-suggest__detail">{option.detail}</span>}
            </div>
          ))}
        </ClayCard>
      )}
    </div>
  );
}
