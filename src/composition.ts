import { probe } from "./edit.js";
import { ff, ffToBuffer } from "./optimize.js";

/**
 * Finds the empty band a generated image so often leaves at an edge: a plain sky or flat colour strip
 * that was meant "for text" and never got any. Measured, not guessed: the image is shrunk to a small
 * greyscale grid and every row and column gets a detail score (standard deviation of brightness). A run
 * of flat, similar rows or columns touching an edge is a band. The result says how much of the frame it
 * takes and gives a crop that removes it while keeping a little breathing room.
 */
export type Edge = "top" | "bottom" | "left" | "right";

export interface Band {
  edge: Edge;
  /** Share of the frame's height (top/bottom) or width (left/right), 0 to 1. */
  share: number;
  /** true when this edge was meant to stay calm for text you're setting there. */
  planned?: boolean;
}

const SAMPLE_W = 96;
const FLAT_STD = 9;
/** Brightness may drift this much from one sample row to the next and still count as one smooth band (a gradient sky). */
const STEP_MEAN = 6;
const MIN_BAND = 0.1;
/** Keep this share of a band when cropping, so the subject doesn't touch the new edge. */
const KEEP_OF_BAND = 0.15;

function lineStats(values: number[]): { mean: number; std: number } {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(v) };
}

function runFromEdge(stats: { mean: number; std: number }[]): number {
  if (!stats.length || stats[0]!.std >= FLAT_STD) return 0;
  let prev = stats[0]!.mean;
  let n = 0;
  for (const s of stats) {
    // Compare with the previous line, not the first one, so a smooth gradient still reads as one band.
    if (s.std >= FLAT_STD || Math.abs(s.mean - prev) > STEP_MEAN) break;
    prev = s.mean;
    n++;
  }
  return n;
}

/** Pure: bands in a w x h greyscale buffer (one byte per pixel, row by row). */
export function findEmptyBands(lum: Uint8Array, w: number, h: number): Band[] {
  const rows = Array.from({ length: h }, (_, y) => lineStats(Array.from(lum.subarray(y * w, y * w + w))));
  const cols = Array.from({ length: w }, (_, x) => lineStats(Array.from({ length: h }, (_, y) => lum[y * w + x]!)));
  const bands: Band[] = [];
  const add = (edge: Edge, n: number, total: number) => {
    // A frame that's flat everywhere is a plain image, not an image with a band.
    if (n / total >= MIN_BAND && n < total * 0.9) bands.push({ edge, share: Math.round((n / total) * 100) / 100 });
  };
  add("top", runFromEdge(rows), h);
  add("bottom", runFromEdge([...rows].reverse()), h);
  add("left", runFromEdge(cols), w);
  add("right", runFromEdge([...cols].reverse()), w);
  return bands;
}

export interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure: a crop of a W x H image that removes the unplanned bands, keeping a little of each as margin. With a
 * target aspect (width / height) the crop keeps that exact shape: the largest window of that shape that fits
 * in the band-free area, centred in it, so a 4:5 post stays 4:5. Even sizes for encoders.
 */
export function cropWithout(allBands: Band[], W: number, H: number, aspect?: number): Crop | undefined {
  const bands = allBands.filter((b) => !b.planned);
  if (!bands.length) return undefined;
  const cut = (edge: Edge, total: number) => {
    const b = bands.find((x) => x.edge === edge);
    return b ? Math.floor(b.share * (1 - KEEP_OF_BAND) * total) : 0;
  };
  const top = cut("top", H);
  const bottom = cut("bottom", H);
  const left = cut("left", W);
  const right = cut("right", W);
  const even = (n: number) => n - (n % 2);
  const rw = W - left - right;
  const rh = H - top - bottom;
  if (!aspect || !Number.isFinite(aspect) || aspect <= 0) return { x: left, y: top, width: even(rw), height: even(rh) };
  let cw = rw;
  let ch = Math.round(rw / aspect);
  if (ch > rh) {
    ch = rh;
    cw = Math.round(rh * aspect);
  }
  return { x: left + Math.floor((rw - cw) / 2), y: top + Math.floor((rh - ch) / 2), width: even(cw), height: even(ch) };
}

/** Pure: brightness spread of a small greyscale thumbnail. A very low value means a flat, washed-out thumbnail. */
export function lumaSpread(lum: Uint8Array): number {
  return Math.round(lineStats(Array.from(lum)).std * 10) / 10;
}

/** Below this the thumbnail is close to one flat tone; nothing reads in a feed at that point. */
export const FLAT_THUMBNAIL = 22;

export interface CompositionResult {
  width: number;
  height: number;
  bands: Band[];
  verdict: "clean" | "empty-band";
  suggestedCrop?: Crop;
  /** Brightness spread of the thumbnail; under FLAT_THUMBNAIL it reads as one flat tone in a feed. */
  thumbnailSpread: number;
  note: string;
}

export async function compositionCheck(input: string, opts: { aspect?: number; plannedEdges?: Edge[] } = {}): Promise<CompositionResult> {
  const info = await probe(input);
  if (!info.width || !info.height) throw new Error("Could not read the image size.");
  const buf = await ffToBuffer(["-i", input, "-vf", `scale=${SAMPLE_W}:-2:flags=area,format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "-frames:v", "1", "pipe:1"]);
  const h = Math.floor(buf.length / SAMPLE_W);
  if (h < 4) throw new Error("Could not read enough pixels from this image.");
  const lum = new Uint8Array(buf.buffer, buf.byteOffset, SAMPLE_W * h);
  const bands = findEmptyBands(lum, SAMPLE_W, h).map((b) => (opts.plannedEdges?.includes(b.edge) ? { ...b, planned: true } : b));
  const unplanned = bands.filter((b) => !b.planned);
  const crop = cropWithout(bands, info.width, info.height, opts.aspect);
  const planned = bands.filter((b) => b.planned);
  return {
    width: info.width,
    height: info.height,
    bands,
    verdict: unplanned.length ? "empty-band" : "clean",
    suggestedCrop: crop,
    thumbnailSpread: lumaSpread(lum),
    note:
      (unplanned.length
        ? `Empty ${unplanned.map((b) => `${b.edge} band (${Math.round(b.share * 100)}% of the frame)`).join(" and ")}. Crop it with suggestedCrop (pass output_path to do it now), or set the headline in it on purpose. Either way, don't ship it empty.`
        : "No empty band at any edge.") +
      (planned.length ? ` The calm ${planned.map((b) => b.edge).join(" and ")} area was planned for text: make sure the text actually goes there.` : ""),
  };
}

export async function applyCrop(input: string, output: string, c: Crop) {
  await ff(["-y", "-i", input, "-vf", `crop=${c.width}:${c.height}:${c.x}:${c.y}`, "-frames:v", "1", ...(/\.jpe?g$/i.test(output) ? ["-q:v", "2"] : []), output]);
}
