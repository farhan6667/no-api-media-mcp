import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
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

function ff(args: string[], timeoutMs = 10 * 60_000): Promise<string> {
  // Inputs may only be local files: no http, no concat/playlist tricks that pull in other paths.
  const safe = args.flatMap((a, i) => (a === "-i" && args[i - 1] !== "-protocol_whitelist" ? ["-protocol_whitelist", "file", a] : [a]));
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...safe], { cwd: tmpdir(), shell: false, windowsHide: true, env: scrubbedEnv() });
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

/**
 * Structural similarity between the optimised file and the original at the same size. 1.0 = identical.
 * Both are flattened onto black first (premultiplied alpha), so colour hidden under fully transparent
 * pixels, which nobody can see and WebP rightly throws away, doesn't count as a difference.
 */
async function ssim(original: string, optimized: string): Promise<number> {
  const flat = "format=yuva444p,premultiply=inplace=1,format=yuv444p";
  const out = await ff([
    "-i", optimized, "-i", original,
    "-lavfi", `[1:v][0:v]scale2ref=flags=lanczos[ref0][dist0];[ref0]${flat}[ref];[dist0]${flat}[dist];[dist][ref]ssim`,
    "-f", "null", "-",
  ]);
  const m = out.match(/All:([\d.]+)/g);
  return m ? Number(m[m.length - 1].slice(4)) : NaN;
}

export interface OptimizeResult {
  output: string;
  originalBytes: number;
  outputBytes: number;
  saved: string;
  ssim: number;
  setting: string;
  rounds: number;
}

/**
 * Make an image smaller for the web without a visible change.
 * Starts at WebP quality 82 and climbs until SSIM >= target (default 0.985), falling back to lossless WebP.
 */
export async function optimizeImage(input: string, output: string, maxWidth?: number, target = 0.985): Promise<OptimizeResult> {
  const scale = maxWidth ? ["-vf", `scale='min(iw,${maxWidth})':-2:flags=lanczos`] : [];
  let rounds = 0;
  let last = { q: 0, s: 0 };
  for (const q of [82, 88, 92, 95, 98]) {
    rounds++;
    await ff(["-y", "-i", input, ...scale, "-c:v", "libwebp", "-quality", String(q), "-compression_level", "6", "-preset", "picture", output]);
    const s = await ssim(input, output);
    last = { q, s };
    if (s >= target) return result(input, output, s, `webp q=${q}`, rounds);
  }
  rounds++;
  await ff(["-y", "-i", input, ...scale, "-c:v", "libwebp", "-lossless", "1", "-compression_level", "6", output]);
  const s = await ssim(input, output);
  return result(input, output, s, `webp lossless (lossy q=${last.q} only reached ${last.s.toFixed(4)})`, rounds);
}

/**
 * Re-encode a video for the web: H.264, yuv420p, +faststart so it starts playing before it fully loads.
 * CRF starts at 23 and steps down until SSIM >= target (default 0.97).
 */
export async function optimizeVideo(
  input: string,
  output: string,
  opts: { maxWidth?: number; keepAudio?: boolean; target?: number } = {},
): Promise<OptimizeResult> {
  const target = opts.target ?? 0.97;
  const vf = opts.maxWidth ? ["-vf", `scale='min(iw,${opts.maxWidth})':-2:flags=lanczos`] : [];
  const audio = opts.keepAudio ? ["-c:a", "aac", "-b:a", "128k"] : ["-an"];
  let rounds = 0;
  let s = 0;
  let crf = 23;
  for (crf of [23, 20, 18, 16]) {
    rounds++;
    await ff(["-y", "-i", input, ...vf, "-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-pix_fmt", "yuv420p", ...audio, "-movflags", "+faststart", output]);
    s = await ssim(input, output);
    if (s >= target) break;
  }
  return result(input, output, s, `h264 crf=${crf}${opts.keepAudio ? " +audio" : " no audio"}`, rounds);
}

function result(input: string, output: string, s: number, setting: string, rounds: number): OptimizeResult {
  const a = statSync(input).size;
  const b = statSync(output).size;
  return { output, originalBytes: a, outputBytes: b, saved: `${Math.round((1 - b / a) * 100)}%`, ssim: Number(s.toFixed(4)), setting, rounds };
}
