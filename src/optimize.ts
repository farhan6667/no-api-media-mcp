import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { inspectMetadata, labels, stripMetadata } from "./metadata.js";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { env, extraBinDirs, scrubbedEnv } from "./config.js";

export function ffmpegPath(): string {
  const custom = env("FFMPEG");
  if (custom && existsSync(custom)) return custom;
  if (platform() === "win32") {
    const winget = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WinGet");
    const links = join(winget, "Links", "ffmpeg.exe");
    if (existsSync(links)) return links;
    // winget's PATH change only reaches new shells; look in its package folder directly.
    try {
      const pkgs = join(winget, "Packages");
      for (const p of readdirSync(pkgs).filter((d) => /^Gyan\.FFmpeg/i.test(d))) {
        for (const build of readdirSync(join(pkgs, p))) {
          const exe = join(pkgs, p, build, "bin", "ffmpeg.exe");
          if (existsSync(exe)) return exe;
        }
      }
    } catch {
      /* no winget packages folder */
    }
  }
  for (const d of extraBinDirs()) if (existsSync(join(d, "ffmpeg"))) return join(d, "ffmpeg");
  return platform() === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

/**
 * Inputs may only be local files: no http, no concat/playlist tricks that pull in other paths.
 * lavfi (generated colour backgrounds) is allowed through -f lavfi, which never reads files or URLs.
 */
export function withFileOnlyInputs(args: string[]): string[] {
  return args.flatMap((a, i) =>
    a === "-i" && args[i - 2] !== "-protocol_whitelist" && args[i - 1] !== "lavfi" ? ["-protocol_whitelist", "file", a] : [a],
  );
}

export function ff(args: string[], timeoutMs = 10 * 60_000, cwd = tmpdir()): Promise<string> {
  const safe = withFileOnlyInputs(args);
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...safe], { cwd, shell: false, windowsHide: true, env: scrubbedEnv() });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", () => reject(new Error("ffmpeg not found. Install it (winget install Gyan.FFmpeg / brew install ffmpeg) or set NOAPI_FFMPEG.")));
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve(err) : reject(new Error(`ffmpeg failed: ${err.slice(-800)}`));
    });
  });
}

/** Same as ff(), but for a pipe:1 raw-data output: returns the binary stdout instead of the stderr log. */
export function ffToBuffer(args: string[], timeoutMs = 60_000, cwd = tmpdir()): Promise<Buffer> {
  const safe = withFileOnlyInputs(args);
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...safe], { cwd, shell: false, windowsHide: true, env: scrubbedEnv() });
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (d) => chunks.push(d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", () => reject(new Error("ffmpeg not found. Install it (winget install Gyan.FFmpeg / brew install ffmpeg) or set NOAPI_FFMPEG.")));
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg failed: ${err.slice(-800)}`));
    });
  });
}

/**
 * Structural similarity between the optimised file and the original at the same size. 1.0 = identical.
 * Both are flattened onto black first (premultiplied alpha), so colour hidden under fully transparent
 * pixels, which nobody can see and WebP rightly throws away, doesn't count as a difference.
 */
export async function ssim(original: string, optimized: string): Promise<number> {
  const flat = "format=yuva444p,premultiply=inplace=1,format=yuv444p";
  const out = await ff([
    "-i", optimized, "-i", original,
    "-lavfi", `[1:v][0:v]scale2ref=flags=lanczos[ref0][dist0];[ref0]${flat}[ref];[dist0]${flat}[dist];[dist][ref]ssim`,
    "-f", "null", "-",
  ]);
  const m = out.match(/All:([\d.]+)/g);
  return m ? Number(m[m.length - 1].slice(4)) : NaN;
}

export interface MetadataReport {
  /** true when stripping was on for this call. */
  stripped: boolean;
  /** Labels no longer present in the output (removed on purpose, or dropped by the encoder). */
  removed: string[];
  /** Labels still present in the output. */
  kept: string[];
  note?: string;
}

export interface OptimizeResult {
  output: string;
  originalBytes: number;
  outputBytes: number;
  saved: string;
  ssim: number;
  setting: string;
  rounds: number;
  metadata: MetadataReport;
  note?: string;
}

const KEEP_NOTE =
  "keep_metadata: nothing was stripped on purpose. Items listed under removed were lost by re-encoding itself " +
  "(a signed C2PA manifest is bound to the original bytes and cannot stay valid in a new file).";

/**
 * After encoding: strip embedded metadata from the output (default) or leave it, and report exactly what
 * happened by comparing what the input carried with what the output still carries.
 */
export async function finishMetadata(input: string, output: string, strip: boolean): Promise<MetadataReport> {
  const before = labels(inspectMetadata(readFileSync(input)).items);
  let removedNow: string[] = [];
  if (strip) {
    let r = stripMetadata(readFileSync(output));
    if (r.needsRemux) {
      // A uuid box sits before the media data: rebuild the container instead of trimming bytes.
      const tmp = `${output}.remux.mp4`;
      await ff(["-y", "-i", output, "-c", "copy", "-map_metadata", "-1", "-map_chapters", "-1", "-movflags", "+faststart", tmp]);
      renameSync(tmp, output);
      r = stripMetadata(readFileSync(output));
      if (r.needsRemux) throw new Error("Could not remove a uuid box from the video container even after re-muxing.");
    }
    if (r.removed.length) writeFileSync(output, r.out);
    removedNow = labels(r.removed);
  }
  const after = labels(inspectMetadata(readFileSync(output)).items);
  const removed = [...new Set([...before.filter((l) => !after.includes(l)), ...removedNow])];
  return {
    stripped: strip,
    removed,
    kept: after,
    note: strip ? (after.length ? "Some metadata is still present; please report this with the file type." : undefined) : KEEP_NOTE,
  };
}

/**
 * Make an image smaller for the web without a visible change.
 * Starts at WebP quality 82 and climbs until SSIM >= target (default 0.985), falling back to lossless WebP.
 */
export type ImageFormat = "webp" | "jpg" | "png";

/** The format an output path asks for, or undefined when its extension isn't one we write. */
export function formatFromPath(path?: string): ImageFormat | undefined {
  const m = /\.(webp|jpe?g|png)$/i.exec(path ?? "");
  if (!m) return undefined;
  const e = m[1].toLowerCase();
  return e === "jpeg" || e === "jpg" ? "jpg" : (e as ImageFormat);
}

/**
 * Make an image smaller without a visible change. WebP climbs from quality 82 and JPEG steps down the
 * quantiser from 8 (smaller) to 2 (larger) until SSIM reaches the target (default 0.985); PNG is lossless.
 * JPEG and PNG exist because some places (LinkedIn post uploads among them) don't take WebP.
 */
export async function optimizeImage(input: string, output: string, maxWidth?: number, target = 0.985, strip = true, format: ImageFormat = "webp"): Promise<OptimizeResult> {
  const scale = maxWidth ? ["-vf", `scale='min(iw,${maxWidth})':-2:flags=lanczos`] : [];
  const meta = strip ? ["-map_metadata", "-1"] : ["-map_metadata", "0"];
  let rounds = 0;
  let last = { q: 0, s: 0 };
  let setting = "";
  if (format === "png") {
    rounds++;
    await ff(["-y", "-i", input, ...scale, ...meta, "-c:v", "png", "-compression_level", "9", "-pred", "mixed", output]);
    last = { q: 100, s: await ssim(input, output) };
    setting = "png lossless";
  } else if (format === "jpg") {
    for (const q of [8, 6, 5, 4, 3, 2]) {
      rounds++;
      await ff(["-y", "-i", input, ...scale, ...meta, "-c:v", "mjpeg", "-q:v", String(q), "-pix_fmt", "yuvj444p", output]);
      const s = await ssim(input, output);
      last = { q, s };
      if (s >= target) {
        setting = `jpeg q:v ${q}`;
        break;
      }
    }
    if (!setting) setting = `jpeg q:v 2 (best JPEG reached ${last.s.toFixed(4)}; use png if that matters)`;
  } else {
    for (const q of [82, 88, 92, 95, 98]) {
      rounds++;
      await ff(["-y", "-i", input, ...scale, ...meta, "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6", "-preset", "picture", output]);
      const s = await ssim(input, output);
      last = { q, s };
      if (s >= target) {
        setting = `webp q=${q}`;
        break;
      }
    }
    if (!setting) {
      // Grainy dark gradients can sit just under the target even at q98 while looking identical.
      // Within 0.01 of the target at q98 is visually lossless; keep it instead of a file several times larger.
      if (last.s >= target - 0.01) setting = `webp q=98 (within 0.01 of target ${target})`;
      else {
        rounds++;
        await ff(["-y", "-i", input, ...scale, ...meta, "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", output]);
        last = { q: 100, s: await ssim(input, output) };
        setting = `webp lossless (lossy q=98 only reached ${last.s.toFixed(4)})`;
      }
    }
  }
  const metadata = await finishMetadata(input, output, strip);
  const r = result(input, output, last.s, setting, rounds);
  return {
    ...r,
    metadata,
    ...(r.outputBytes > r.originalBytes ? { note: "The new file is larger than the original. Keep the original unless you need this format." } : {}),
  };
}

/**
 * Re-encode a video for the web: H.264, yuv420p, +faststart so it starts playing before it fully loads.
 * CRF starts at 23 and steps down until SSIM >= target (default 0.97).
 */
export async function optimizeVideo(
  input: string,
  output: string,
  opts: { maxWidth?: number; keepAudio?: boolean; target?: number; strip?: boolean } = {},
): Promise<OptimizeResult> {
  const target = opts.target ?? 0.97;
  const strip = opts.strip ?? true;
  const vf = opts.maxWidth ? ["-vf", `scale='min(iw,${opts.maxWidth})':-2:flags=lanczos`] : [];
  const audio = opts.keepAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"];
  // Container tags and chapters: dropped when stripping, carried over from the input otherwise.
  const meta = strip ? ["-map_metadata", "-1", "-map_chapters", "-1"] : ["-map_metadata", "0"];
  let rounds = 0;
  let s = 0;
  let crf = 23;
  for (crf of [23, 20, 18, 16]) {
    rounds++;
    await ff(["-y", "-i", input, ...vf, ...meta, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", ...audio, "-movflags", "+faststart", output]);
    s = await ssim(input, output);
    if (s >= target) break;
  }
  const metadata = await finishMetadata(input, output, strip);
  return { ...result(input, output, s, `h264 crf=${crf}${opts.keepAudio ? " +audio" : " no audio"}`, rounds), metadata };
}

function result(input: string, output: string, s: number, setting: string, rounds: number): Omit<OptimizeResult, "metadata"> {
  const a = statSync(input).size;
  const b = statSync(output).size;
  return { output, originalBytes: a, outputBytes: b, saved: `${Math.round((1 - b / a) * 100)}%`, ssim: Number(s.toFixed(4)), setting, rounds };
}
