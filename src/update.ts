import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { scrubbedEnv } from "./config.js";
import { installedFromNpm, npmCliPath, updateCommand } from "./install.js";

/**
 * A version check only, never a silent self-patch. The server tells you a newer version exists and exactly
 * what to run; it only installs it itself when you have explicitly opted in with NOAPI_AUTO_UPDATE=1.
 *
 * This matters for a tool with a threat model that already treats "a cloned repo, a web page, a hostile
 * prompt" as adversaries (see SECURITY.md): pulling and running new code without anyone looking is the same
 * class of risk, so the default stays notify-only. GitHub's release API is read over plain HTTPS with no
 * credentials, a byte cap and a timeout, and failures here must never break a real tool call.
 */
const RELEASES_URL = "https://api.github.com/repos/farhan6667/no-api-media-mcp/releases/latest";
const MAX_RESPONSE_BYTES = 200_000;
const DEFAULT_TIMEOUT_MS = 4_000;
/** A plain release version. Anything else (a git URL, a file: spec, a dist-tag) is never handed to npm. */
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,6}(-[0-9A-Za-z.]{1,30})?$/;

export const _test = { VERSION_RE };

export interface ReleaseInfo {
  version: string;
  name: string;
  url: string;
}

export type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** "1.2.0" < "1.10.0" correctly, unlike a plain string compare. Anything unparsable sorts as not-newer. */
export function isNewer(candidate: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/i, "").split(".").map((n) => Number.parseInt(n, 10));
  const a = parse(candidate);
  const b = parse(current);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

async function fetchLatestRelease(fetcher: Fetcher, timeoutMs: number): Promise<ReleaseInfo | undefined> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(RELEASES_URL, { signal: controller.signal, headers: { "User-Agent": "no-api-media-mcp", Accept: "application/vnd.github+json" } });
    if (!res.ok) return undefined;
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) return undefined;
    const data = JSON.parse(text) as { tag_name?: unknown; name?: unknown; html_url?: unknown };
    if (typeof data.tag_name !== "string") return undefined;
    const version = data.tag_name.replace(/^v/i, "");
    if (!VERSION_RE.test(version)) return undefined;
    return {
      version,
      name: typeof data.name === "string" ? data.name.slice(0, 200) : data.tag_name,
      url: typeof data.html_url === "string" && data.html_url.startsWith("https://github.com/farhan6667/no-api-media-mcp/") ? data.html_url : "https://github.com/farhan6667/no-api-media-mcp/releases/latest",
    };
  } catch {
    return undefined; // network error, timeout, bad JSON: never breaks the caller
  } finally {
    clearTimeout(t);
  }
}

export interface UpdateState {
  lastCheckedAt?: string;
  lastSeenVersion?: string;
}

export interface CheckOptions {
  currentVersion: string;
  intervalHours: number;
  now?: number;
  fetcher?: Fetcher;
  timeoutMs?: number;
}

export interface CheckResult {
  state: UpdateState;
  /** Only set when a check actually ran and found a version newer than currentVersion. */
  release?: ReleaseInfo;
}

/** Rate-limited: only calls the network when the interval has elapsed. Returns the (possibly unchanged) state to persist. */
export async function checkForUpdate(saved: UpdateState, opts: CheckOptions): Promise<CheckResult> {
  const now = opts.now ?? Date.now();
  const last = saved.lastCheckedAt ? Date.parse(saved.lastCheckedAt) : 0;
  const due = !Number.isFinite(last) || now - last >= opts.intervalHours * 3_600_000;
  if (!due) {
    const seen = saved.lastSeenVersion;
    return { state: saved, release: seen && isNewer(seen, opts.currentVersion) ? { version: seen, name: seen, url: "https://github.com/farhan6667/no-api-media-mcp/releases/latest" } : undefined };
  }
  const fetcher = opts.fetcher ?? (fetch as unknown as Fetcher);
  const release = await fetchLatestRelease(fetcher, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const state: UpdateState = { lastCheckedAt: new Date(now).toISOString(), lastSeenVersion: release?.version ?? saved.lastSeenVersion };
  return { state, release: release && isNewer(release.version, opts.currentVersion) ? release : undefined };
}

export function updateNotice(release: ReleaseInfo, currentVersion: string, fromNpm: boolean = installedFromNpm()): string {
  return (
    `A newer no-api-media-mcp is out: v${release.version} (you have v${currentVersion}). "${release.name}". ` +
    `Update with: ${updateCommand(fromNpm)}, or see ${release.url}. ` +
    `Set NOAPI_CHECK_UPDATES=0 to stop this check` +
    (fromNpm ? `, or NOAPI_AUTO_UPDATE=1 to install new versions automatically (installs for the next run; it never patches the server while it's running).` : ".")
  );
}

export interface AutoInstallOptions {
  /** Default: worked out from where this copy lives. Auto-update only ever runs for an npm install. */
  fromNpm?: boolean;
  /** Default: npm's own npm-cli.js next to the running Node. */
  npmCli?: string;
}

/**
 * Only ever called when the user has set NOAPI_AUTO_UPDATE=1. Installs exactly the version GitHub reported,
 * through npm's own script run by Node (no shell, no npm.cmd lookup), from the temp folder, with a scrubbed env.
 * A git checkout is never touched: it says how to update by hand instead.
 */
export function autoInstall(version: string, opts: AutoInstallOptions = {}): Promise<{ ok: boolean; detail: string }> {
  const fromNpm = opts.fromNpm ?? installedFromNpm();
  if (!fromNpm) return Promise.resolve({ ok: false, detail: `This copy is a git checkout, so it is not updated automatically. Update with: ${updateCommand(false)}.` });
  if (!VERSION_RE.test(version)) return Promise.resolve({ ok: false, detail: `Refusing to install "${version.slice(0, 40)}": not a plain release version.` });
  const cli = opts.npmCli ?? npmCliPath();
  if (!cli) return Promise.resolve({ ok: false, detail: "Could not find npm next to this Node. Update by hand: npm install -g no-api-media-mcp@latest" });
  return new Promise((resolve) => {
    let out = "";
    let p;
    try {
      p = spawn(process.execPath, [cli, "install", "-g", `no-api-media-mcp@${version}`], { cwd: tmpdir(), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: scrubbedEnv() });
    } catch (e) {
      resolve({ ok: false, detail: (e as Error).message });
      return;
    }
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => {
      p.kill();
      resolve({ ok: false, detail: "npm install timed out" });
    }, 120_000);
    p.on("error", (e) => {
      clearTimeout(t);
      resolve({ ok: false, detail: e.message });
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ ok: code === 0, detail: out.slice(-800) });
    });
  });
}
