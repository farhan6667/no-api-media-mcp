import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MEDIA_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"]);

export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve the nearest existing ancestor through symlinks so a link inside the project can't point outside it. */
function realAncestor(p: string): string {
  let cur = p;
  while (!existsSync(cur)) {
    const up = dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  const real = realpathSync(cur);
  return join(real, relative(cur, p));
}

export function slugify(text: string, max = 48): string {
  const s = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "media";
}

/**
 * Decide where a file goes.
 * - With no outputPath: <root>/.ai-media/<provider>/<date>-<slug>.<ext>
 * - With an outputPath: it must resolve inside one of the allowed roots and use a media extension.
 * Throws on anything else, so a prompt-injected instruction can't make the server write to Startup, ~/.ssh, etc.
 */
export function resolveOutput(opts: {
  roots: string[];
  outputPath?: string;
  provider: string;
  prompt: string;
  ext: string;
  overwrite?: boolean;
  now?: Date;
  /** Validate only: don't create folders. Used before spending quota on a generation. */
  dryRun?: boolean;
}): string {
  const roots = opts.roots.map((r) => realpathSync(resolve(r)));
  let target: string;

  if (!opts.outputPath) {
    const d = (opts.now ?? new Date()).toISOString().slice(0, 10);
    const base = `${d}-${slugify(opts.prompt)}`;
    const dir = join(roots[0], ".ai-media", opts.provider);
    target = join(dir, `${base}${opts.ext}`);
    let n = 2;
    while (existsSync(target)) target = join(dir, `${base}-${n++}${opts.ext}`);
  } else {
    if (/^\\\\|^\/\//.test(opts.outputPath)) throw new Error("Network (UNC) paths are not allowed.");
    // A colon after the drive letter means an NTFS alternate data stream (hero.png:hidden.png).
    if (opts.outputPath.slice(2).includes(":")) throw new Error("Colons are not allowed in file names.");
    for (const seg of opts.outputPath.split(/[\\/]+/)) {
      if (/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i.test(seg)) throw new Error(`"${seg}" is a reserved device name on Windows.`);
      if (/[. ]$/.test(seg) && seg !== "." && seg !== "..") throw new Error("Names ending in a dot or space are not allowed.");
    }
    target = resolve(roots[0], opts.outputPath);
    const ext = extname(target).toLowerCase();
    if (!MEDIA_EXTS.has(ext)) throw new Error(`Output must be a media file (${[...MEDIA_EXTS].join(", ")}), got "${ext || "none"}".`);
    if (basename(target).startsWith(".")) throw new Error("Hidden file names are not allowed.");
  }

  const real = realAncestor(target);
  if (!roots.some((r) => isInside(real, r))) {
    throw new Error(`Refusing to write outside the allowed folders: ${roots.join(", ")}`);
  }
  if (existsSync(real) && !opts.overwrite) throw new Error(`File already exists: ${real}. Pass overwrite: true to replace it.`);
  if (!opts.dryRun) mkdirSync(dirname(real), { recursive: true });
  return real;
}

/** Strip anything that could identify the account or carry a session from text we log or return. */
export function redact(text: string): string {
  return text
    .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, "$1?…")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+)\b/g, "<jwt>")
    .replace(/\b(sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{30,}|gh[pousr]_[A-Za-z0-9]{30,}|xai-[A-Za-z0-9]{20,}|ya29\.[A-Za-z0-9._-]{20,})\b/g, "<secret>")
    .replace(/1\/\/[A-Za-z0-9_-]{20,}/g, "<secret>")
    .replace(/\b((?:__Secure-|__Host-)?[A-Z0-9]*(?:SID|SAPISID|PSID[A-Z]*|SSID|HSID|APISID|session[-_]?token|cf_clearance|__cf_bm)[A-Za-z0-9_-]*)=([^;\s"']+)/gi, "$1=<cookie>")
    // Also matches JSON-escaped paths (C:\\Users\\name), which is how they appear in tool output.
    .replace(/([A-Za-z]:(?:\\{1,2})Users(?:\\{1,2})|\/Users\/|\/home\/)[^\\/\s"']+/gi, "~");
}

/** "Jane Doe (someone@gmail.com)" -> "s***@gmail.com". Never return a person's display name. */
export function maskAccount(label: string): string {
  const m = label.match(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/);
  return m ? `${m[1]}***@${m[2]}` : label ? "signed in" : "";
}

/** Refuse anything but https to a public host name (no IP literals, no localhost, no internal names). */
export function assertPublicHttps(url: string, allowedHosts?: string[]) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("Invalid media URL.");
  }
  if (u.protocol !== "https:") throw new Error("Refusing non-https media URL.");
  const h = u.hostname.toLowerCase();
  if (/^\[|^\d+\.\d+\.\d+\.\d+$|^localhost$|\.local$|\.internal$|^[^.]+$/.test(h)) throw new Error("Refusing media URL on a private or local host.");
  if (allowedHosts && !allowedHosts.some((a) => h === a || h.endsWith(`.${a}`))) {
    throw new Error(`Refusing media from unexpected host ${h}.`);
  }
}

export function log(...parts: unknown[]) {
  // stdout is the MCP channel; logs go to stderr only, redacted.
  process.stderr.write(redact(parts.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")) + "\n");
}

/** One job at a time, plus a minimum gap per provider so we behave like a person, not a bot farm. */
export class JobGate {
  private tail: Promise<unknown> = Promise.resolve();
  private last = new Map<string, number>();
  constructor(private minGapMs: number) {}

  run<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(async () => {
      const wait = (this.last.get(provider) ?? 0) + this.minGapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      try {
        return await fn();
      } finally {
        this.last.set(provider, Date.now());
      }
    });
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** Detect real type from bytes, never trust the server's headers or the requested extension. */
export function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") return { mime: "image/png", ext: ".png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return { mime: "image/webp", ext: ".webp" };
  if (buf.toString("ascii", 0, 3) === "GIF") return { mime: "image/gif", ext: ".gif" };
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    return buf.toString("ascii", 8, 12) === "qt  " ? { mime: "video/quicktime", ext: ".mov" } : { mime: "video/mp4", ext: ".mp4" };
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: "video/webm", ext: ".webm" };
  return null;
}

export function imageSize(buf: Buffer): { width: number; height: number } | undefined {
  if (buf[0] === 0x89 && buf.toString("ascii", 12, 16) === "IHDR") return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 12, 16) === "VP8X") {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  return undefined;
}

export const SEP = sep;
