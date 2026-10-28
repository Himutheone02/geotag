/**
 * "Save Score": a won route as a keepsake PNG, drawn with the Canvas API alone (no
 * libraries, no network). It looks like a printed instant photo / trading card: the
 * final route map as the photo, an off-white card with a soft drop shadow on the game's
 * peach-lavender backdrop, the route and time in the wide bottom border, and the
 * geotag logo at the foot.
 *
 * The map is the live <svg>, copied with the page's computed styles written onto each
 * element (an SVG drawn as an image can't see the page's stylesheet or fonts), then
 * drawn as an image. Its place-name labels are drawn on the canvas instead, in Fredoka,
 * which the page has already loaded.
 */

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

/** Card layout, in canvas pixels. */
const CARD = { x: 90, y: 70, w: 900, h: 1210, r: 28 };
const PHOTO = { x: 140, y: 120, w: 800, h: 800, r: 14 };

const INK = "#2d2a4a";
const INK_SOFT = "#5a5578";
const PAPER_TOP = "#fffdf7";
const PAPER_BOTTOM = "#f5efe3";
const SEA = "#dce8fb";
const SHADOW = "94, 82, 158";
const FONT = 'Fredoka, ui-rounded, "SF Pro Rounded", system-ui, sans-serif';

/** The style properties that decide how the map draws. Everything else stays out of the copy. */
const MAP_STYLES = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linejoin",
  "stroke-linecap",
  "opacity",
  "vector-effect",
  "display",
  "visibility",
] as const;

export type ScoreCardInput = {
  /** The route map, as it looks now. */
  map: SVGSVGElement;
  /** The header's "geotag" wordmark, already loaded. Null: the name is set in type instead. */
  logo: HTMLImageElement | null;
  /** "France to China". */
  title: string;
  /** "01:23". */
  time: string;
  /** "5 moves · shortest route 4 · Oct 27, 2026". */
  details: string;
};

/**
 * A standalone copy of the map, sized `width` x `height`, with each element's computed
 * style written inline. Labels, tap targets and the tap outline are left out.
 */
export function mapForExport(svg: SVGSVGElement, width: number, height: number): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals = [svg, ...svg.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  originals.forEach((el, i) => {
    const computed = getComputedStyle(el);
    const style = MAP_STYLES.map((prop) => [prop, computed.getPropertyValue(prop)] as const)
      .filter(([, value]) => value !== "")
      .map(([prop, value]) => `${prop}:${value}`)
      .join(";");
    if (style) copies[i].setAttribute("style", style);
    else copies[i].removeAttribute("style");
  });
  for (const node of clone.querySelectorAll("text, title, .map-hits, .map-selected")) node.remove();
  clone.removeAttribute("class");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(clone);
}

/** The map's place-name labels, in its own (viewBox) coordinates. */
function mapLabels(svg: SVGSVGElement): { text: string; x: number; y: number }[] {
  return [...svg.querySelectorAll<SVGTextElement>("text.map-label")].map((t) => ({
    text: t.textContent ?? "",
    x: Number(t.getAttribute("x")),
    y: Number(t.getAttribute("y")),
  }));
}

/** "geotag-france-to-china.png" */
export function scoreCardFileName(title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `geotag-${slug || "route"}.png`;
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Centered text, shrunk until it fits `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, weight: number, size: number) {
  let px = size;
  ctx.font = `${weight} ${px}px ${FONT}`;
  while (px > 18 && ctx.measureText(text).width > maxWidth) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${FONT}`;
  }
  ctx.fillText(text, x, y);
}

async function svgImage(markup: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Draws the card. Resolves to the PNG, or null if this browser can't draw it. */
export async function renderScoreCard({ map, logo, title, time, details }: ScoreCardInput): Promise<Blob | null> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  try {
    await Promise.all([document.fonts?.load(`700 92px ${FONT}`), document.fonts?.load(`500 28px ${FONT}`)]);
  } catch {
    // Fall back to the next font in the stack.
  }
  const mapImage = await svgImage(mapForExport(map, PHOTO.w, PHOTO.h));

  // Backdrop: the splash's peach-to-lavender.
  const backdrop = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  backdrop.addColorStop(0, "#ffe3d3");
  backdrop.addColorStop(0.5, "#f4dcf0");
  backdrop.addColorStop(1, "#ddd4ff");
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // The card: a soft wide shadow and a tight contact shadow, then the paper.
  const paper = ctx.createLinearGradient(CARD.x, CARD.y, CARD.x + CARD.w, CARD.y + CARD.h);
  paper.addColorStop(0, PAPER_TOP);
  paper.addColorStop(1, PAPER_BOTTOM);
  for (const [blur, offset, alpha] of [
    [80, 34, 0.32],
    [8, 4, 0.18],
  ] as const) {
    ctx.save();
    ctx.shadowColor = `rgba(${SHADOW}, ${alpha})`;
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = offset / 2;
    ctx.shadowOffsetY = offset;
    roundedRect(ctx, CARD.x, CARD.y, CARD.w, CARD.h, CARD.r);
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.restore();
  }
  // Card edges catch the light top-left and fall into shade bottom-right.
  ctx.save();
  roundedRect(ctx, CARD.x + 1.5, CARD.y + 1.5, CARD.w - 3, CARD.h - 3, CARD.r - 1.5);
  const edge = ctx.createLinearGradient(CARD.x, CARD.y, CARD.x + CARD.w, CARD.y + CARD.h);
  edge.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  edge.addColorStop(1, `rgba(${SHADOW}, 0.18)`);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // The photo: the route map on its sea, pressed slightly into the card.
  ctx.save();
  roundedRect(ctx, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, PHOTO.r);
  ctx.clip();
  ctx.fillStyle = SEA;
  ctx.fillRect(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
  ctx.drawImage(mapImage, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);

  // Place names, positioned the way the map's viewBox places them (scaled to fit, centered).
  const { x: vx, y: vy, width: vw, height: vh } = map.viewBox.baseVal;
  if (vw > 0 && vh > 0) {
    const scale = Math.min(PHOTO.w / vw, PHOTO.h / vh);
    const ox = PHOTO.x + (PHOTO.w - vw * scale) / 2 - vx * scale;
    const oy = PHOTO.y + (PHOTO.h - vh * scale) / 2 - vy * scale;
    ctx.font = `600 30px ${FONT}`;
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    for (const label of mapLabels(map)) {
      const x = ox + label.x * scale;
      const y = oy + label.y * scale;
      ctx.lineWidth = 7;
      ctx.strokeStyle = "#ffffff";
      ctx.strokeText(label.text, x, y);
      ctx.fillStyle = INK;
      ctx.fillText(label.text, x, y);
    }
  }

  // Inner shadow along the photo's top and left: it sits in the card, not on it.
  ctx.shadowColor = `rgba(${SHADOW}, 0.35)`;
  ctx.shadowBlur = 22;
  ctx.shadowOffsetX = 5;
  ctx.shadowOffsetY = 7;
  ctx.beginPath();
  ctx.rect(PHOTO.x - 60, PHOTO.y - 60, PHOTO.w + 120, PHOTO.h + 120);
  ctx.rect(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
  ctx.fillStyle = "#000000";
  ctx.fill("evenodd");
  ctx.restore();
  ctx.save();
  roundedRect(ctx, PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h, PHOTO.r);
  ctx.strokeStyle = `rgba(${SHADOW}, 0.22)`;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // The wide bottom border: route, time, details, logo.
  const center = CARD.x + CARD.w / 2;
  const textWidth = PHOTO.w - 40;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  fitText(ctx, title, center, 1000, textWidth, 600, 46);
  fitText(ctx, time, center, 1096, textWidth, 700, 92);
  ctx.fillStyle = INK_SOFT;
  fitText(ctx, details, center, 1146, textWidth, 500, 28);

  if (logo && logo.complete && logo.naturalWidth > 0) {
    const h = 66;
    const w = (logo.naturalWidth / logo.naturalHeight) * h;
    ctx.drawImage(logo, center - w / 2, 1180, w, h);
  } else {
    ctx.fillStyle = INK;
    fitText(ctx, "geotag", center, 1232, textWidth, 700, 52);
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

/** Hands the PNG to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Let the download start before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
