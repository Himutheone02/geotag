"use client";

import { useEffect, useState } from "react";

/**
 * The flags (src/data/flags.ts, all 195 as SVG markup) are one build file, about 400 KB
 * gzipped, so the page loads it on its own: when Vexillology Mode opens, and a few seconds
 * after the game starts in any case, so the service worker has it for offline play.
 */
export type FlagSet = Readonly<Record<string, string>>;

let loading: Promise<FlagSet> | null = null;

export function loadFlags(): Promise<FlagSet> {
  loading ??= import("@/data/flags")
    .then((m) => m.FLAGS)
    .catch((error) => {
      loading = null; // try again next time
      throw error;
    });
  return loading;
}

/** The flags once loaded (null until then). `wanted`: start loading now. */
export function useFlags(wanted: boolean): FlagSet | null {
  const [flags, setFlags] = useState<FlagSet | null>(null);
  useEffect(() => {
    if (!wanted || flags) return;
    let live = true;
    loadFlags()
      .then((set) => {
        if (live) setFlags(set);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [wanted, flags]);
  return flags;
}

const sources = new Map<string, string>();

/** A data: URL for a flag's SVG, made once per flag. Shown with <img>, so no flag can run script. */
export function flagSrc(flags: FlagSet, code: string): string | null {
  const svg = flags[code];
  if (!svg) return null;
  let src = sources.get(code);
  if (!src) {
    src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    sources.set(code, src);
  }
  return src;
}

type FlagProps = {
  flags: FlagSet | null;
  code: string;
  /** Empty for a decorative flag next to the country's name. */
  alt: string;
  className?: string;
};

/** One flag at 4:3. Before the flags load, an empty clay slot of the same shape. */
export default function Flag({ flags, code, alt, className }: FlagProps) {
  const src = flags ? flagSrc(flags, code) : null;
  if (!src) return <span className={["flag", "flag--loading", className].filter(Boolean).join(" ")} aria-hidden="true" />;
  // eslint-disable-next-line @next/next/no-img-element -- a data: URL; next/image adds nothing here
  return <img className={["flag", className].filter(Boolean).join(" ")} src={src} alt={alt} width={4} height={3} decoding="async" />;
}
