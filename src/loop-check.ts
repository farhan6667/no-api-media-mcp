import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { probe } from "./edit.js";
import { ff, ssim } from "./optimize.js";

/**
 * A background-video or product-video meant to loop lives or dies on whether its first and last frame
 * match closely: a mismatch reads as a jump or a jerk the moment it repeats. This extracts both frames and
 * reuses the same structural-similarity check media_optimize already runs against quality loss, just
 * comparing two frames of one video instead of an original and a compressed copy.
 */
const SEAMLESS_THRESHOLD = 0.92;

export interface LoopCheckResult {
  similarity: number;
  seamless: boolean;
  durationSeconds?: number;
}

export async function loopCheck(input: string): Promise<LoopCheckResult> {
  const info = await probe(input);
  if (!info.duration || info.duration <= 0) throw new Error("loop_check needs a video with a readable duration.");
  const dir = mkdtempSync(join(tmpdir(), "noapi-loop-"));
  try {
    const first = join(dir, "first.png");
    const last = join(dir, "last.png");
    await ff(["-y", "-i", input, "-frames:v", "1", first]);
    const fps = info.fps && info.fps > 0 ? info.fps : 30;
    const lastAt = Math.max(0, info.duration - 1 / fps);
    await ff(["-y", "-ss", lastAt.toFixed(3), "-i", input, "-frames:v", "1", last]);
    const similarity = await ssim(first, last);
    return { similarity: Number(similarity.toFixed(4)), seamless: similarity >= SEAMLESS_THRESHOLD, durationSeconds: info.duration };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
