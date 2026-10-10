import { ffToBuffer } from "./optimize.js";

/**
 * Pulls the dominant colours out of a real generated (or any) image, so a website's design system can be
 * built to actually match what got generated, instead of guessing. No new dependency: the image is
 * downscaled by ffmpeg itself (area-averaging, so noise and compression artefacts get smoothed out) to a
 * small raw RGB buffer, then bucketed in plain JS. This is a simple colour histogram, not a perceptual
 * clustering algorithm: it's meant to be a fast, honest starting point for a palette, not a finished
 * brand system.
 */
const SAMPLE_SIZE = 48;
const BUCKET = 24;

export interface DominantColor {
  hex: string;
  /** Share of sampled pixels in this colour's bucket, 0 to 1. */
  weight: number;
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0");
}

export async function dominantColors(input: string, count = 6): Promise<DominantColor[]> {
  if (count < 1 || count > 12) throw new Error("count must be between 1 and 12");
  const buf = await ffToBuffer(["-i", input, "-vf", `scale=${SAMPLE_SIZE}:${SAMPLE_SIZE}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-frames:v", "1", "pipe:1"]);
  if (buf.length < 3) throw new Error("Could not read any pixels from this image.");

  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  let total = 0;
  for (let i = 0; i + 2 < buf.length; i += 3) {
    const r = buf[i]!;
    const g = buf[i + 1]!;
    const b = buf[i + 2]!;
    const key = `${Math.round(r / BUCKET)}_${Math.round(g / BUCKET)}_${Math.round(b / BUCKET)}`;
    const e = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    e.r += r;
    e.g += g;
    e.b += b;
    e.n += 1;
    buckets.set(key, e);
    total++;
  }

  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((e) => ({ hex: `#${toHex(e.r / e.n)}${toHex(e.g / e.n)}${toHex(e.b / e.n)}`, weight: Math.round((e.n / total) * 1000) / 1000 }));
}

/** A plain :root CSS custom-properties block, ordered most to least dominant. Naming is left to the caller: this doesn't guess which colour is "primary" or "background". */
export function cssVariables(colors: DominantColor[], prefix = "palette"): string {
  const lines = colors.map((c, i) => `  --${prefix}-${i + 1}: ${c.hex};`);
  return [":root {", ...lines, "}"].join("\n");
}
