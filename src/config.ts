import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";

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

  const file = join(home, "config.json");
  const saved: Partial<Config> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};

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
