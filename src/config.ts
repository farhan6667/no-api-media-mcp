import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import tls from "node:tls";

/**
 * Trust the operating system's certificate store as well as Node's bundled one, exactly like Chrome does.
 * Without this, media downloads fail on machines behind a corporate proxy or antivirus that inspects TLS
 * ("unable to verify the first certificate"). Needs a recent Node 22/24; older Node keeps its default.
 */
export function trustSystemCertificates() {
  const t = tls as typeof tls & {
    getCACertificates?: (type: string) => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (!t.getCACertificates || !t.setDefaultCACertificates) return;
  try {
    const all = new Set([...t.getCACertificates("default"), ...t.getCACertificates("system")]);
    t.setDefaultCACertificates([...all]);
  } catch {
    /* keep Node's default store */
  }
}

export interface Config {
  /** Where the private browser profile and state live. Never inside a repo. */
  home: string;
  profileDir: string;
  /** Directories the server may write into. Defaults to the project it was started in. */
  outputRoots: string[];
  chromePath: string;
  /** Optional: the Google account to use when several are signed in (matched on the page, never put in a URL). */
  googleEmail?: string;
  /** Minimum seconds between two generations on the same provider. */
  minGapSeconds: number;
  /**
   * Strip embedded metadata (EXIF, XMP, C2PA manifests) from files produced by media_optimize.
   * Default true. Off via config.json strip_ai_metadata=false, NO_API_MEDIA_KEEP_METADATA=1,
   * or keep_metadata: true on a call. Disclosed in the README and in every tool result.
   */
  stripAiMetadata: boolean;
  /** Remove old rejected or used drafts from <project>/.ai-media once per session. Default true. */
  autoCleanup: boolean;
  /**
   * Let several sessions of this server share one signed-in browser as separate tabs, so their jobs run
   * side by side. Default true, because this runs on the user's own machine: it opens a loopback-only
   * Chrome devtools port while the browser is open, which another local process could attach to, so turn
   * it off on a shared machine. Off means a second session waits in a queue instead.
   */
  shareBrowser: boolean;
  /** Check GitHub for a newer release. Default true. Off via NOAPI_CHECK_UPDATES=0. */
  checkUpdates: boolean;
  /** Run `npm install -g` for a newer version once found. Default false: notify only. On via NOAPI_AUTO_UPDATE=1. */
  autoUpdate: boolean;
  updateCheckIntervalHours: number;
}

export function readConfigFile(home: string): Record<string, unknown> {
  const file = join(home, "config.json");
  try {
    return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function writeConfigFile(home: string, patch: Record<string, unknown>) {
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "config.json"), JSON.stringify({ ...readConfigFile(home), ...patch }, null, 2));
}

/** Disclosed once after upgrading to 0.3.0, in the first media_optimize result and by `setup`/`status`. */
export const STRIP_NOTICE =
  "Behaviour notice (new in 0.3.0): media_optimize strips embedded metadata from the files it writes " +
  "(EXIF, XMP, C2PA content credentials, text chunks), the way most web image optimizers do. Your originals " +
  "are untouched. Turn it off with keep_metadata: true on a call, NO_API_MEDIA_KEEP_METADATA=1, or " +
  "`no-api-media-mcp config set strip_ai_metadata false`. This removes metadata only; invisible watermarks " +
  "such as Google SynthID stay in the pixels, and platform rules on AI disclosure still apply to you.";

/** Precedence: per-call keep_metadata > environment > config.json > default (strip). */
export function resolveStrip(saved: Record<string, unknown>, environment: NodeJS.ProcessEnv = process.env): boolean {
  const keep = environment.NO_API_MEDIA_KEEP_METADATA ?? environment.NOAPI_KEEP_METADATA;
  if (keep !== undefined && keep !== "" && keep !== "0" && keep.toLowerCase() !== "false") return false;
  const v = saved.strip_ai_metadata ?? saved.stripAiMetadata;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() !== "false";
  return true;
}

/** Precedence: environment NOAPI_AUTO_CLEANUP=0, then config.json auto_cleanup, then default (on). */
export function resolveAutoCleanup(saved: Record<string, unknown>, environment: NodeJS.ProcessEnv = process.env): boolean {
  const e = environment.NOAPI_AUTO_CLEANUP;
  if (e !== undefined && e !== "") return !(e === "0" || e.toLowerCase() === "false");
  const v = saved.auto_cleanup;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() !== "false";
  return true;
}

/** Precedence: environment NOAPI_SHARE_BROWSER, then config.json share_browser, then default (on). */
export function resolveShareBrowser(saved: Record<string, unknown>, environment: NodeJS.ProcessEnv = process.env): boolean {
  const e = environment.NOAPI_SHARE_BROWSER;
  if (e !== undefined && e !== "") return !(e === "0" || e.toLowerCase() === "false");
  const v = saved.share_browser;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.toLowerCase() !== "false";
  return true;
}

function flag(name: string, def: boolean): boolean {
  const v = env(name);
  if (v === undefined || v === "") return def;
  return !(v === "0" || v.toLowerCase() === "false");
}

function findChrome(): string {
  const fromEnv = env("CHROME");
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates =
    platform() === "win32"
      ? [
          join(process.env["PROGRAMFILES"] ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
          join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
          join(process.env["LOCALAPPDATA"] ?? "", "Google\\Chrome\\Application\\chrome.exe"),
        ]
      : platform() === "darwin"
        ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const hit = candidates.find((c) => c && existsSync(c));
  if (!hit) throw new Error("Google Chrome not found. Install Chrome or set NOAPI_CHROME to its path.");
  return hit;
}

/**
 * Global npm root WITHOUT running npm. Shelling out to `cmd /c npm` with the project as cwd would run
 * a planted npm.cmd from a cloned repo, so we only look at well-known locations.
 */
export function npmGlobalRoots(): string[] {
  const out: string[] = [];
  if (platform() === "win32") {
    if (process.env.APPDATA) out.push(join(process.env.APPDATA, "npm", "node_modules"));
    out.push(join(dirname(process.execPath), "node_modules"));
  } else {
    out.push(
      join(dirname(process.execPath), "..", "lib", "node_modules"),
      "/opt/homebrew/lib/node_modules",
      "/usr/local/lib/node_modules",
      "/usr/lib/node_modules",
      join(homedir(), ".npm-global", "lib", "node_modules"),
    );
  }
  return out.filter((p) => existsSync(p));
}

/** Directories to look in for CLIs when an MCP client starts us with a minimal PATH (common on macOS). */
export function extraBinDirs(): string[] {
  return platform() === "win32"
    ? []
    : ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", join(homedir(), ".local", "bin"), join(dirname(process.execPath))];
}

/**
 * Environment for child CLIs with every API-key-like variable removed, so a developer's exported
 * OPENAI_API_KEY can never turn a "subscription" generation into a paid API call.
 */
export function scrubbedEnv(): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/(API_?KEY|_TOKEN|SECRET|ACCESS_KEY|PASSWORD)$/i.test(k) || /^(OPENAI|CODEX|AZURE_OPENAI)_/i.test(k)) continue;
    e[k] = v;
  }
  return e;
}

/** NOAPI_X, falling back to the pre-rename AI_ACCOUNTS_X. */
export function env(name: string): string | undefined {
  return process.env[`NOAPI_${name}`] ?? process.env[`AI_ACCOUNTS_${name}`];
}

function defaultHome(): string {
  const current = join(homedir(), ".no-api-media");
  if (existsSync(current)) return current;
  // Keep existing sign-ins working for people who installed under an earlier pre-release name.
  for (const legacy of [".no-api-key-studio", ".ai-accounts-mcp"]) {
    const p = join(homedir(), legacy);
    if (existsSync(p)) return p;
  }
  return current;
}

export function loadConfig(): Config {
  const home = resolve(env("HOME") ?? defaultHome());
  mkdirSync(home, { recursive: true });

  const saved = readConfigFile(home) as Partial<Config> & Record<string, unknown>;

  const roots = (env("OUTPUT_ROOTS") ?? "")
    .split(platform() === "win32" ? ";" : ":")
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => resolve(r));

  return {
    home,
    profileDir: join(home, "chrome-profile"),
    outputRoots: roots.length ? roots : [resolve(process.cwd())],
    chromePath: findChrome(),
    googleEmail: env("GOOGLE_EMAIL") ?? saved.googleEmail,
    minGapSeconds: Number(env("MIN_GAP") ?? saved.minGapSeconds ?? 20),
    stripAiMetadata: resolveStrip(saved),
    autoCleanup: resolveAutoCleanup(saved),
    shareBrowser: resolveShareBrowser(saved),
    checkUpdates: flag("CHECK_UPDATES", true),
    autoUpdate: flag("AUTO_UPDATE", false),
    updateCheckIntervalHours: Number(env("UPDATE_CHECK_HOURS") ?? 24) || 24,
  };
}

/** Small persistent state, e.g. the Flow project we reuse so we don't litter the user's account. */
export function readState(cfg: Config): Record<string, string> {
  const f = join(cfg.home, "state.json");
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
}

export function writeState(cfg: Config, patch: Record<string, string>) {
  const f = join(cfg.home, "state.json");
  writeFileSync(f, JSON.stringify({ ...readState(cfg), ...patch }, null, 2));
}
