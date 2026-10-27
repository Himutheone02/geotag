"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import ClayCard from "@/components/ui/ClayCard";

export type MapTip = {
  /** Tap position, in px from the map container's top-left corner. */
  x: number;
  y: number;
  title: string;
  detail?: string;
};

/** Gap between the tap point and the card, and the card's minimum distance from the container's edges. */
const GAP = 14;
const EDGE = 8;

/**
 * A small clay card floating by the tap point on the map. Lightweight: no library,
 * one measurement when it opens (to keep it inside the map and flip it below the
 * tap point near the top edge), and a spring pop on transform and opacity only.
 *
 * It stays open until the caller closes it (the next tap, a tap elsewhere, Escape),
 * so on a phone it doesn't vanish when the finger lifts.
 *
 * Render it inside a `position: relative` container, keyed per tap so the pop replays.
 */
export default function MapTooltip({ tip }: { tip: MapTip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<{ left: number; top: number; below: boolean } | null>(null);

  // Measure before paint, then place: centered over the tap, kept inside the container.
  useLayoutEffect(() => {
    const el = ref.current;
    const container = el?.offsetParent as HTMLElement | null;
    if (!el || !container) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const maxLeft = container.clientWidth - w - EDGE;
    const left = Math.min(Math.max(tip.x - w / 2, EDGE), Math.max(EDGE, maxLeft));
    const below = tip.y - GAP - h < EDGE;
    setPlaced({ left, top: below ? tip.y + GAP : tip.y - GAP - h, below });
  }, [tip.x, tip.y]);

  return (
    <div
      ref={ref}
      className={placed?.below ? "map-tip map-tip--below" : "map-tip"}
      style={
        placed
          ? ({ left: placed.left, top: placed.top, "--tip-origin-x": `${tip.x - placed.left}px` } as CSSProperties)
          : { left: 0, top: 0, visibility: "hidden" }
      }
    >
      <ClayCard className="map-tip__card">
        <span className="map-tip__title">{tip.title}</span>
        {tip.detail && <span className="map-tip__detail">{tip.detail}</span>}
      </ClayCard>
    </div>
  );
}
