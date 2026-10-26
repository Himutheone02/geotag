"use client";

import { memo, useMemo, useState, type AnimationEvent } from "react";
import { geoGraticule, geoNaturalEarth1, geoPath, type GeoPath, type GeoProjection } from "d3-geo";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { RoundKey } from "@/app/CountryGuesser";
import worldMap from "@/data/world-map.json";

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

/** A country outline; `id` is its cca3 code, or null for unlabeled land (Kosovo, N. Cyprus...). */
type CountryShape = Omit<Feature<Polygon | MultiPolygon, Record<string, never>>, "id"> & { id: string | null };

const topology = worldMap.topology as unknown as Topology<{ countries: GeometryCollection }>;
const WORLD = (feature(topology, topology.objects.countries) as unknown as FeatureCollection).features as unknown as CountryShape[];
const SHAPE_BY_CODE = new Map(WORLD.filter((f) => f.id).map((f) => [f.id as string, f]));
const POINTS = worldMap.points as unknown as Record<string, [number, number]>;

/* ------------------------------------------------------------------ */
/* Framing per round (continents, empires, world)                      */
/* ------------------------------------------------------------------ */

const WIDTH = 800;
/**
 * Below this projected area (square view units) a country also gets a dot marker,
 * at continent zoom. Zoomed out (world frames) both the threshold and the dot
 * shrink, or ~80 dots would bury Europe and the Caribbean.
 */
const MIN_VISIBLE_AREA = 40;
const MARKER_RADIUS = 5.5;
/** Projection scale of a typical continent frame; zoom factors are relative to it. */
const CONTINENT_SCALE = 600;

export type MapFrame = {
  /** Longitude the projection is centered on (keeps Oceania whole across the 180° line). */
  center: number;
  /** [[west, south], [east, north]] in degrees. East may exceed 180 to wrap past the antimeridian. */
  extent: [[number, number], [number, number]];
};

/** Whole world, split at the 180° meridian (center 10°E, as on most wall maps). */
const WORLD_FRAME: MapFrame = { center: 10, extent: [[-170, -57], [190, 80]] };

/**
 * Hand-set frames, checked by a test that every country of every round is on screen.
 * Frames are set per round rather than computed from the countries: a computed box
 * would follow Russia's center point into Siberia for the Ottoman round, and the
 * British Empire spans every longitude.
 */
export const MAP_FRAMES: Record<RoundKey, MapFrame> = {
  Africa: { center: 18, extent: [[-26, -36], [60, 38]] },
  Americas: { center: -95, extent: [[-170, -56], [-30, 75]] },
  Asia: { center: 88, extent: [[25, -12], [150, 56]] },
  Europe: { center: 12, extent: [[-25, 34], [46, 71]] },
  Oceania: { center: 158, extent: [[110, -48], [192, 16]] },
  // Empires
  Roman: { center: 18, extent: [[-13, 17], [50, 61]] }, // Europe, North Africa, the Levant
  Mughal: { center: 78, extent: [[59, 5], [99, 40]] }, // South Asia
  Ottoman: { center: 25, extent: [[-10, -3], [62, 53]] }, // Balkans to the Horn of Africa
  Soviet: { center: 100, extent: [[18, 34], [192, 78]] }, // Baltic to the Bering Strait
  British: WORLD_FRAME, // every continent
  World: WORLD_FRAME,
};

/**
 * A frame fitted around a set of countries (used for land routes, whose two
 * endpoints can be anywhere). Built from each country's center point, padded,
 * with a minimum size so short routes aren't over-zoomed and a minimum height
 * so wide routes (Portugal to China) don't become a thin strip.
 */
export function frameAround(codes: readonly string[]): MapFrame {
  const points = codes.map((code) => POINTS[code]).filter(Boolean);
  let west = Math.min(...points.map((p) => p[0]));
  let east = Math.max(...points.map((p) => p[0]));
  let south = Math.min(...points.map((p) => p[1]));
  let north = Math.max(...points.map((p) => p[1]));
  const padLon = Math.max(8, (east - west) * 0.2);
  const padLat = Math.max(6, (north - south) * 0.2);
  west -= padLon;
  east += padLon;
  south -= padLat;
  north += padLat;
  const grow = (lo: number, hi: number, min: number): [number, number] => {
    const mid = (lo + hi) / 2;
    return hi - lo >= min ? [lo, hi] : [mid - min / 2, mid + min / 2];
  };
  [west, east] = grow(west, east, 30);
  [south, north] = grow(south, north, Math.max(22, (east - west) * 0.45));
  south = Math.max(south, -58);
  north = Math.min(north, 80);
  return { center: (west + east) / 2, extent: [[west, south], [east, north]] };
}

/** How to frame the map: a round's named frame, an explicit frame, or "fit these countries". */
export type FrameSpec = RoundKey | MapFrame | { around: readonly string[] };

function resolveFrame(spec: FrameSpec): MapFrame {
  if (typeof spec === "string") return MAP_FRAMES[spec];
  return "around" in spec ? frameAround(spec.around) : spec;
}

export type TargetGeometry = {
  code: string;
  /** SVG path, or null when the dataset has no outline (Tuvalu). */
  d: string | null;
  /** Dot position when the country is too small to see, otherwise null. */
  marker: [number, number] | null;
  /** Point the fill-in "pop" scales from: the center of the largest landmass, kept inside the view. */
  origin: [number, number];
  /** Projected [[x0, y0], [x1, y1]] of the outline, or null without one. */
  bounds: [[number, number], [number, number]] | null;
};

export type MapGeometry = {
  viewBox: [number, number, number, number];
  /** Dot radius for this zoom level. */
  markerRadius: number;
  /** Every land shape in the world (other continents are drawn as muted context). */
  shapes: { code: string | null; d: string }[];
  targets: Map<string, TargetGeometry>;
};

function largestPolygonCentroid(shape: CountryShape, path: GeoPath): [number, number] {
  const polygons: Polygon[] =
    shape.geometry.type === "Polygon"
      ? [shape.geometry]
      : shape.geometry.coordinates.map((coordinates) => ({ type: "Polygon", coordinates }));
  let best = polygons[0];
  let bestArea = -1;
  for (const p of polygons) {
    const area = path.area(p);
    if (area > bestArea) {
      bestArea = area;
      best = p;
    }
  }
  return path.centroid(best);
}

/** Projects the world for one round (a named frame, or a custom one). Pure: also used by tests. */
export function buildMapGeometry(frameSpec: FrameSpec, targetCodes: readonly string[]): MapGeometry {
  const frame = resolveFrame(frameSpec);
  const outline = geoGraticule().extent(frame.extent).outline();
  const projection: GeoProjection = geoNaturalEarth1().rotate([-frame.center, 0]).fitWidth(WIDTH, outline);
  const path = geoPath(projection).digits(1);
  const [[x0, y0], [x1, y1]] = path.bounds(outline);
  const viewBox: MapGeometry["viewBox"] = [x0, y0, x1 - x0, y1 - y0];
  const zoom = Math.min(1, projection.scale() / CONTINENT_SCALE); // ~0.24 for the whole world
  const minVisibleArea = MIN_VISIBLE_AREA * zoom ** 1.4;
  const markerRadius = Math.max(3, MARKER_RADIUS * Math.sqrt(zoom));

  const clampToView = ([x, y]: [number, number]): [number, number] => [
    Math.min(Math.max(x, x0), x1),
    Math.min(Math.max(y, y0), y1),
  ];

  const shapes = WORLD.map((f) => ({ code: f.id, d: path(f as Feature) ?? "" }))
    .filter((s) => s.d !== "");

  const targets = new Map<string, TargetGeometry>();
  for (const code of targetCodes) {
    const shape = SHAPE_BY_CODE.get(code);
    const point = POINTS[code] ? (projection(POINTS[code]) as [number, number] | null) : null;
    const d = shape ? path(shape as Feature) || null : null;
    const tooSmall = !d || path.area(shape as Feature) < minVisibleArea;
    const origin = shape && d ? largestPolygonCentroid(shape, path) : (point ?? [x0, y0]);
    targets.set(code, {
      code,
      d,
      marker: tooSmall && point ? point : null,
      origin: clampToView(origin),
      bounds: d ? (path.bounds(shape as Feature) as [[number, number], [number, number]]) : null,
    });
  }
  return { viewBox, markerRadius, shapes, targets };
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

type Endpoint = { code: string; name: string };

type SvgMapProps = {
  /** Which framing to use. Objects must be stable between renders (useMemo). */
  frame: FrameSpec;
  /** Round name for the accessible label, e.g. "Africa" or "Roman Empire". */
  label: string;
  /** Color theme for named countries (continent or empire). null colors each country by its continent. */
  theme: string | null;
  /** cca3 -> continent, used when theme is null (World Mode). Must be stable between renders. */
  regions: Readonly<Record<string, string>>;
  /** cca3 codes of the round's countries. Must be a stable array between renders. */
  targets: readonly string[];
  /** Named countries. Must be a stable Set between renders (memoize it). */
  named: ReadonlySet<string>;
  /** A missing country to pulse (hint stage 2), or null. */
  highlight: string | null;
  /** Land routes: start and end, always highlighted and labeled. `reached` stops the end's pulse. Stable object. */
  endpoints?: { start: Endpoint; end: Endpoint; reached: boolean };
  /** Overrides the accessible description. */
  description?: string;
  /**
   * A static color per country (a heatmap), with a tooltip. These are drawn straight onto
   * the clay layer, with no pop: use with an empty `named` set. Stable object.
   */
  fills?: Readonly<Record<string, { color: string; title: string }>>;
};

/** Clay depth for SVG: outer drop shadow + light top-left inner edge + dark bottom-right inner edge. */
function ClayFilter({ id, depth }: { id: string; depth: number }) {
  return (
    <filter id={id} x="-10%" y="-10%" width="125%" height="130%" colorInterpolationFilters="sRGB">
      <feGaussianBlur in="SourceAlpha" stdDeviation={3 * depth} result="dropBlur" />
      <feOffset in="dropBlur" dx={3 * depth} dy={4 * depth} result="dropOffset" />
      <feFlood floodColor="#5e529e" floodOpacity={0.28} />
      <feComposite in2="dropOffset" operator="in" result="drop" />

      <feOffset in="SourceAlpha" dx={1.6 * depth} dy={1.6 * depth} result="shiftTL" />
      <feComposite in="SourceAlpha" in2="shiftTL" operator="out" result="edgeTL" />
      <feGaussianBlur in="edgeTL" stdDeviation={0.9 * depth} result="edgeTLBlur" />
      <feComposite in="edgeTLBlur" in2="SourceAlpha" operator="in" result="edgeTLClip" />
      <feFlood floodColor="#ffffff" floodOpacity={0.9} />
      <feComposite in2="edgeTLClip" operator="in" result="light" />

      <feOffset in="SourceAlpha" dx={-1.8 * depth} dy={-1.8 * depth} result="shiftBR" />
      <feComposite in="SourceAlpha" in2="shiftBR" operator="out" result="edgeBR" />
      <feGaussianBlur in="edgeBR" stdDeviation={0.9 * depth} result="edgeBRBlur" />
      <feComposite in="edgeBRBlur" in2="SourceAlpha" operator="in" result="edgeBRClip" />
      <feFlood floodColor="#5e529e" floodOpacity={0.35} />
      <feComposite in2="edgeBRClip" operator="in" result="dark" />

      <feMerge>
        <feMergeNode in="drop" />
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="light" />
        <feMergeNode in="dark" />
      </feMerge>
    </filter>
  );
}

/**
 * Inline SVG map of one round (a continent, an empire, or the world).
 *
 * Filters are applied per layer (all land, named countries), not per path:
 * one filter pass instead of ~240 keeps it fast. CSS drop-shadow() cannot
 * draw the inset half of the clay recipe, so these are SVG filters.
 *
 * A newly named country pops on an unfiltered layer and joins the clay layer
 * once its spring settles. Animating inside a filtered group makes the browser
 * re-run the filter every frame (measured: 12 fps instead of 60 in Chromium).
 *
 * Remount per round (give it a `key`) so the settled set starts empty.
 *
 * Memoized: typing re-renders the game on every keystroke, but the map only
 * re-renders when the named set or the hint changes.
 */
function SvgMap({ frame, label, theme, regions, targets, named, highlight, endpoints, description, fills }: SvgMapProps) {
  const geometry = useMemo(() => buildMapGeometry(frame, targets), [frame, targets]);
  // In themed rounds the whole map shares one color; in World Mode each country uses its continent's.
  const regionOf = (code: string) => (theme ? undefined : regions[code]);
  const targetSet = useMemo(() => new Set(targets), [targets]);
  const namedInOrder = targets.filter((code) => named.has(code));
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const settle = (code: string) => (e: AnimationEvent<SVGPathElement>) => {
    const running = (e.currentTarget.getAnimations?.() ?? []).some((a) => a.playState !== "finished");
    if (!running) setSettled((prev) => new Set(prev).add(code));
  };
  const hint = highlight && !named.has(highlight) ? geometry.targets.get(highlight) : undefined;
  const [vx, vy, vw, vh] = geometry.viewBox;

  return (
    <svg
      className="world-map"
      viewBox={`${vx} ${vy} ${vw} ${vh}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={description ?? `Map of ${label}: ${named.size} of ${targets.length} countries named`}
      data-theme={theme ?? undefined}
    >
      <defs>
        <ClayFilter id="map-clay-land" depth={1} />
        <ClayFilter id="map-clay-named" depth={1.3} />
      </defs>

      <g filter="url(#map-clay-land)">
        {geometry.shapes.map((s, i) => (
          <path
            key={i}
            d={s.d}
            data-code={s.code ?? undefined}
            className={s.code && targetSet.has(s.code) ? "map-country map-country--target" : "map-country"}
          />
        ))}
      </g>

      <g filter="url(#map-clay-named)">
        {fills &&
          targets.map((code) => {
            const t = geometry.targets.get(code);
            const fill = fills[code];
            if (!t?.d || !fill) return null;
            return (
              <path key={`fill-${code}`} d={t.d} data-code={code} className="map-named map-named--fill" style={{ fill: fill.color }}>
                <title>{fill.title}</title>
              </path>
            );
          })}
        {namedInOrder.map((code) => {
          const t = geometry.targets.get(code);
          if (!t?.d || !settled.has(code)) return null;
          return <path key={code} d={t.d} data-code={code} data-region={regionOf(code)} className="map-named" />;
        })}
      </g>

      <g>
        {namedInOrder.map((code) => {
          const t = geometry.targets.get(code);
          if (!t?.d || settled.has(code)) return null;
          return (
            <path
              key={code}
              d={t.d}
              data-code={code}
              data-region={regionOf(code)}
              className="map-named map-named--popping"
              style={{ transformOrigin: `${t.origin[0]}px ${t.origin[1]}px` }}
              onAnimationEnd={settle(code)}
            />
          );
        })}
      </g>

      <g>
        {targets.map((code) => {
          const t = geometry.targets.get(code);
          if (!t?.marker) return null;
          const fill = fills?.[code];
          if (fill) {
            return (
              <circle
                key={`${code}-fill`}
                cx={t.marker[0]}
                cy={t.marker[1]}
                r={geometry.markerRadius}
                data-code={code}
                className="map-marker map-marker--fill"
                style={{ fill: fill.color }}
              >
                <title>{fill.title}</title>
              </circle>
            );
          }
          return (
            <circle
              key={named.has(code) ? `${code}-named` : code}
              cx={t.marker[0]}
              cy={t.marker[1]}
              r={geometry.markerRadius}
              data-code={code}
              data-region={named.has(code) ? regionOf(code) : undefined}
              className={named.has(code) ? "map-marker map-marker--named" : "map-marker"}
            />
          );
        })}
      </g>

      {endpoints && (
        <g className="map-endpoints">
          {(["start", "end"] as const).map((role) => {
            const t = geometry.targets.get(endpoints[role].code);
            if (!t) return null;
            const reached = role === "end" && endpoints.reached;
            return (
              <g
                key={role}
                data-code={t.code}
                className={`map-endpoint map-endpoint--${role}${reached ? " map-endpoint--reached" : ""}`}
              >
                {t.d && <path d={t.d} />}
                {t.marker && <circle cx={t.marker[0]} cy={t.marker[1]} r={geometry.markerRadius * 1.4} />}
              </g>
            );
          })}
          {(["start", "end"] as const).map((role) => {
            const t = geometry.targets.get(endpoints[role].code);
            if (!t) return null;
            const [x, y] = t.marker ?? t.origin;
            return (
              <text key={`${role}-label`} x={x} y={y - geometry.markerRadius * 2.2} className="map-label" textAnchor="middle">
                {endpoints[role].name}
              </text>
            );
          })}
        </g>
      )}

      {hint && (
        <g className="map-hint" data-code={hint.code}>
          {hint.d && <path d={hint.d} className="map-hint-shape" />}
          {hint.marker && (
            <circle cx={hint.marker[0]} cy={hint.marker[1]} r={geometry.markerRadius * 2} className="map-hint-ring" />
          )}
        </g>
      )}
    </svg>
  );
}

export default memo(SvgMap);
