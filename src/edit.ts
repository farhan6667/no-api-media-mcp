import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import tls from "node:tls";
import { env, extraBinDirs, scrubbedEnv } from "./config.js";
import { ff, ffmpegPath } from "./optimize.js";

/**
 * Local media editing, no network, no API keys: ffmpeg for video and resizing, rembg (BiRefNet models)
 * for background removal. User text never goes into an ffmpeg filter string: it is written to a file
 * in a private temp folder and read with textfile=, so it can't inject filter options.
 */

function workdir() {
  return mkdtempSync(join(tmpdir(), "noapi-edit-"));
}
function cleanup(dir: string) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* leftover temp folder */
  }
}

// ---------- probe ----------

export function ffprobePath(): string {
  const f = ffmpegPath();
  const p = join(dirname(f), basename(f).replace(/^ffmpeg/i, "ffprobe"));
  return existsSync(p) ? p : platform() === "win32" ? "ffprobe.exe" : "ffprobe";
}

export function probe(file: string): Promise<{ duration?: number; width?: number; height?: number; video?: string; audio?: string; fps?: number }> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffprobePath(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-protocol_whitelist", "file", file], {
      cwd: tmpdir(),
      shell: false,
      windowsHide: true,
      env: scrubbedEnv(),
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => reject(new Error("ffprobe not found (it comes with ffmpeg).")));
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error("ffprobe could not read the file."));
      const j = JSON.parse(out);
      const v = j.streams?.find((s: { codec_type: string }) => s.codec_type === "video");
      const a = j.streams?.find((s: { codec_type: string }) => s.codec_type === "audio");
      const [n, d] = String(v?.r_frame_rate ?? "0/1").split("/").map(Number);
      resolve({
        duration: j.format?.duration ? Number(Number(j.format.duration).toFixed(2)) : undefined,
        width: v?.width,
        height: v?.height,
        video: v?.codec_name,
        audio: a?.codec_name,
        fps: d ? Number((n / d).toFixed(2)) : undefined,
      });
    });
  });
}

// ---------- fonts ----------

function systemFont(bold = true): string | undefined {
  const c =
    platform() === "win32"
      ? [join(process.env.WINDIR ?? "C:\\Windows", "Fonts", bold ? "segoeuib.ttf" : "segoeui.ttf"), join(process.env.WINDIR ?? "C:\\Windows", "Fonts", "arialbd.ttf")]
      : platform() === "darwin"
        ? ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Helvetica.ttc"]
        : ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf", "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf"];
  return c.find((f) => existsSync(f));
}

// ---------- social sizes ----------

export const SOCIAL_PRESETS = {
  "favicon-32": { w: 32, h: 32, ext: ".png" },
  "apple-touch-180": { w: 180, h: 180, ext: ".png" },
  "icon-512": { w: 512, h: 512, ext: ".png" },
  "og-1200x630": { w: 1200, h: 630, ext: ".jpg" },
  "x-1600x900": { w: 1600, h: 900, ext: ".jpg" },
  "linkedin-1200x627": { w: 1200, h: 627, ext: ".jpg" },
  "linkedin-portrait-1080x1350": { w: 1080, h: 1350, ext: ".jpg" },
  "instagram-square-1080": { w: 1080, h: 1080, ext: ".jpg" },
  "instagram-portrait-1080x1350": { w: 1080, h: 1350, ext: ".jpg" },
  "story-1080x1920": { w: 1080, h: 1920, ext: ".jpg" },
  "youtube-thumb-1280x720": { w: 1280, h: 720, ext: ".jpg" },
  "pinterest-1000x1500": { w: 1000, h: 1500, ext: ".jpg" },
  "github-social-1280x640": { w: 1280, h: 640, ext: ".jpg" },
} as const;
export type SocialPreset = keyof typeof SOCIAL_PRESETS;

/**
 * cover: fill the frame, cropping the edges (good for photos).
 * contain: fit the whole image inside a blurred, darkened copy of itself (good for logos and posters, nothing is cut).
 * pad: fit inside a solid colour.
 */
function fitFilter(w: number, h: number, fit: "cover" | "contain" | "pad", padColor: string): string {
  if (fit === "cover") return `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h},setsar=1`;
  if (fit === "pad") return `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=${padColor},setsar=1`;
  return (
    `[0:v]split[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=40,eq=brightness=-0.12[bg];` +
    `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`
  );
}

export async function socialSizes(input: string, outFor: (preset: SocialPreset, ext: string) => string, presets: SocialPreset[], fit: "cover" | "contain" | "pad", padColor = "0x0b1020") {
  const results: { preset: string; file: string; width: number; height: number }[] = [];
  for (const p of presets) {
    const { w, h, ext } = SOCIAL_PRESETS[p];
    const f = ext === ".png" ? (fit === "contain" ? "pad" : fit) : fit; // icons stay crisp, no blur halo
    const out = outFor(p, ext);
    await ff(["-y", "-i", input, "-filter_complex", fitFilter(w, h, f, padColor), "-frames:v", "1", ...(ext === ".jpg" ? ["-q:v", "2"] : []), out]);
    results.push({ preset: p, file: out, width: w, height: h });
  }
  return results;
}

// ---------- video editing ----------

export type VideoOp =
  | { op: "trim"; start: number; end?: number }
  | { op: "reframe"; aspect: "9:16" | "1:1" | "16:9" | "4:5" | "4:3"; fit: "cover" | "contain" }
  | { op: "speed"; factor: number }
  | { op: "fade"; fadeIn: number; fadeOut: number }
  | { op: "mute" }
  | { op: "replace_audio"; audio: string }
  | { op: "extract_frame"; at: number }
  | { op: "gif"; start: number; duration: number; width: number; fps: number }
  | { op: "text"; text: string; position: "top" | "center" | "bottom"; size: number; color: string; box: boolean }
  | { op: "logo"; logo: string; position: "top-left" | "top-right" | "bottom-left" | "bottom-right"; widthPercent: number }
  | { op: "subtitles"; srt: string }
  | { op: "concat"; others: string[] };

const ASPECT_SIZE: Record<string, [number, number]> = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080], "4:5": [1080, 1350], "4:3": [1440, 1080] };
const H264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];

export async function videoEdit(input: string, op: VideoOp, out: string): Promise<void> {
  const dir = workdir();
  try {
    switch (op.op) {
      case "trim": {
        const to = op.end !== undefined ? ["-to", String(op.end)] : [];
        await ff(["-y", "-ss", String(op.start), ...to, "-i", input, ...H264, "-c:a", "aac", out]);
        break;
      }
      case "reframe": {
        const [w, h] = ASPECT_SIZE[op.aspect];
        await ff(["-y", "-i", input, "-filter_complex", fitFilter(w, h, op.fit === "cover" ? "cover" : "contain", "black"), ...H264, "-c:a", "copy", out]);
        break;
      }
      case "speed": {
        const f = op.factor;
        // atempo accepts 0.5..2 per stage, so chain stages for bigger changes.
        const stages: number[] = [];
        let r = f;
        while (r > 2) (stages.push(2), (r /= 2));
        while (r < 0.5) (stages.push(0.5), (r /= 0.5));
        stages.push(r);
        const audio = (await probe(input)).audio;
        const fc = `[0:v]setpts=PTS/${f}[v]` + (audio ? `;[0:a]${stages.map((s) => `atempo=${s.toFixed(4)}`).join(",")}[a]` : "");
        await ff(["-y", "-i", input, "-filter_complex", fc, "-map", "[v]", ...(audio ? ["-map", "[a]"] : []), ...H264, out]);
        break;
      }
      case "fade": {
        const d = (await probe(input)).duration ?? 0;
        const vf = [op.fadeIn > 0 ? `fade=t=in:st=0:d=${op.fadeIn}` : "", op.fadeOut > 0 ? `fade=t=out:st=${Math.max(0, d - op.fadeOut)}:d=${op.fadeOut}` : ""].filter(Boolean).join(",") || "null";
        const af = [op.fadeIn > 0 ? `afade=t=in:st=0:d=${op.fadeIn}` : "", op.fadeOut > 0 ? `afade=t=out:st=${Math.max(0, d - op.fadeOut)}:d=${op.fadeOut}` : ""].filter(Boolean).join(",") || "anull";
        const audio = (await probe(input)).audio;
        await ff(["-y", "-i", input, "-vf", vf, ...(audio ? ["-af", af] : []), ...H264, out]);
        break;
      }
      case "mute":
        await ff(["-y", "-i", input, "-c:v", "copy", "-an", out]);
        break;
      case "replace_audio":
        await ff(["-y", "-i", input, "-i", op.audio, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", out]);
        break;
      case "extract_frame":
        await ff(["-y", "-ss", String(op.at), "-i", input, "-frames:v", "1", "-q:v", "2", out]);
        break;
      case "gif": {
        const fc = `[0:v]fps=${op.fps},scale=${op.width}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
        await ff(["-y", "-ss", String(op.start), "-t", String(op.duration), "-i", input, "-filter_complex", fc, "-loop", "0", out]);
        break;
      }
      case "text": {
        const font = systemFont(true);
        if (!font) throw new Error("No system font found for text overlays.");
        copyFileSync(font, join(dir, "font.ttf"));
        writeFileSync(join(dir, "text.txt"), op.text, "utf8");
        const y = op.position === "top" ? "h*0.08" : op.position === "center" ? "(h-text_h)/2" : "h-text_h-h*0.08";
        const box = op.box ? ":box=1:boxcolor=black@0.45:boxborderw=24" : "";
        // expansion=none: show the text literally, so "%{...}" in user text can never call ffmpeg functions.
        const vf = `drawtext=fontfile=font.ttf:textfile=text.txt:expansion=none:fontsize=${op.size}:fontcolor=${op.color}:x=(w-text_w)/2:y=${y}${box}:shadowcolor=black@0.5:shadowx=2:shadowy=2`;
        const isImage = /\.(png|jpe?g|webp)$/i.test(out);
        await ff(["-y", "-i", input, "-vf", vf, ...(isImage ? ["-frames:v", "1"] : [...H264, "-c:a", "copy"]), out], 10 * 60_000, dir);
        break;
      }
      case "logo": {
        const m = "main_w*0.04";
        const pos = {
          "top-left": `${m}:${m}`,
          "top-right": `main_w-overlay_w-${m}:${m}`,
          "bottom-left": `${m}:main_h-overlay_h-${m}`,
          "bottom-right": `main_w-overlay_w-${m}:main_h-overlay_h-${m}`,
        }[op.position];
        // Scale the logo to a share of the video's width, keeping the logo's own aspect ratio (dar).
        const fc = `[1:v][0:v]scale2ref=w=main_w*${op.widthPercent / 100}:h=ow/dar[lg][base];[base][lg]overlay=${pos}`;
        const isImage = /\.(png|jpe?g|webp)$/i.test(out);
        await ff(["-y", "-i", input, "-i", op.logo, "-filter_complex", fc, ...(isImage ? ["-frames:v", "1"] : [...H264, "-c:a", "copy"]), out]);
        break;
      }
      case "subtitles": {
        copyFileSync(op.srt, join(dir, "subs.srt"));
        const font = systemFont(false);
        if (font) copyFileSync(font, join(dir, "font.ttf"));
        try {
          // Readable on phones: larger font with an outline. The style string is fixed, never user input.
          const style = ":force_style='FontSize=22,Outline=2,Shadow=1,MarginV=40'";
          await ff(["-y", "-i", input, "-vf", `subtitles=subs.srt${font ? ":fontsdir=." : ""}${style}`, ...H264, "-c:a", "copy", out], 20 * 60_000, dir);
        } catch {
          // Some builds can't use a fonts dir; libass then falls back to system fonts.
          await ff(["-y", "-i", input, "-vf", "subtitles=subs.srt", ...H264, "-c:a", "copy", out], 20 * 60_000, dir);
        }
        break;
      }
      case "concat": {
        // Normalise every clip to the first one's size, then join with the concat filter (no list files).
        const all = [input, ...op.others];
        const first = await probe(input);
        const w = first.width ?? 1280;
        const h = first.height ?? 720;
        const withAudio = await Promise.all(all.map(async (f) => Boolean((await probe(f)).audio)));
        const audio = withAudio.every(Boolean);
        const parts = all.map((_, i) => `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`).join(";");
        const join_ = all.map((_, i) => `[v${i}]${audio ? `[${i}:a]` : ""}`).join("") + `concat=n=${all.length}:v=1:a=${audio ? 1 : 0}[v]${audio ? "[a]" : ""}`;
        await ff(["-y", ...all.flatMap((f) => ["-i", f]), "-filter_complex", `${parts};${join_}`, "-map", "[v]", ...(audio ? ["-map", "[a]"] : []), ...H264, out], 30 * 60_000);
        break;
      }
    }
  } finally {
    cleanup(dir);
  }
}

// ---------- background removal ----------

const REMBG_MODELS = {
  fast: "birefnet-general-lite",
  best: "birefnet-general",
  portrait: "birefnet-portrait",
  anime: "isnet-anime",
} as const;
export type BgQuality = keyof typeof REMBG_MODELS;

function rembgPath(): string {
  const custom = env("REMBG");
  if (custom && existsSync(custom)) return custom;
  const exe = platform() === "win32" ? "rembg.exe" : "rembg";
  for (const d of [join(homedir(), ".local", "bin"), ...extraBinDirs()]) if (existsSync(join(d, exe))) return join(d, exe);
  return exe;
}

/** rembg downloads its model with Python requests, which ignores the OS store; hand it the same CAs Chrome trusts. */
function caBundle(home: string): string | undefined {
  const t = tls as typeof tls & { getCACertificates?: (type: string) => string[] };
  if (!t.getCACertificates) return undefined;
  const file = join(home, "ca-bundle.pem");
  try {
    writeFileSync(file, [...new Set([...t.getCACertificates("default"), ...t.getCACertificates("system")])].join("\n"));
    return file;
  } catch {
    return undefined;
  }
}

export function removeBackground(input: string, out: string, quality: BgQuality, home: string, signal?: AbortSignal): Promise<void> {
  const dir = workdir();
  const ca = caBundle(home);
  const e = scrubbedEnv();
  if (ca && !e.REQUESTS_CA_BUNDLE) e.REQUESTS_CA_BUNDLE = ca;
  if (ca && !e.SSL_CERT_FILE) e.SSL_CERT_FILE = ca;
  return new Promise((resolve, reject) => {
    const p = spawn(rembgPath(), ["i", "-m", REMBG_MODELS[quality], input, out], { cwd: dir, shell: false, windowsHide: true, env: e, stdio: ["ignore", "pipe", "pipe"], signal });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill(), 15 * 60_000);
    p.on("error", (x) => {
      clearTimeout(t);
      cleanup(dir);
      reject(
        x.name === "AbortError"
          ? new Error("Cancelled")
          : new Error('Background removal needs rembg. Install it once: uv tool install "rembg[cpu,cli]" (or pip install "rembg[cpu,cli]").'),
      );
    });
    p.on("close", (code) => {
      clearTimeout(t);
      cleanup(dir);
      if (code === 0 && existsSync(out)) return resolve();
      if (/No onnxruntime backend/i.test(err)) return reject(new Error('rembg is installed without a backend. Reinstall: uv tool install --force "rembg[cpu,cli]"'));
      if (/SSL|CERTIFICATE/i.test(err)) return reject(new Error("Downloading the background model failed on a certificate check. Your network inspects TLS; try again on another network once, the model is cached afterwards."));
      reject(new Error(`rembg failed: ${err.trim().split("\n").at(-1)?.slice(0, 300)}`));
    });
  });
}
