import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { env, extraBinDirs, npmGlobalRoots, scrubbedEnv } from "../config.js";
import { assertPublicHttps } from "../safety.js";

/**
 * Higgsfield ships an official CLI with OAuth (PKCE) browser login, so no website automation is needed.
 * Credits come from the user's Higgsfield plan. We never call `auth token`, so the token is never printed.
 */
function hfBinary(): string {
  const custom = env("HIGGSFIELD");
  if (custom && existsSync(custom)) return custom;
  const exe = platform() === "win32" ? "hf.exe" : "hf";
  // Found without running npm, so a planted npm.cmd in the project can't execute.
  for (const root of npmGlobalRoots()) {
    const bin = join(root, "@higgsfield", "cli", "vendor", exe);
    if (existsSync(bin)) return bin;
  }
  for (const d of extraBinDirs()) {
    for (const name of ["higgsfield", "hf"]) if (existsSync(join(d, name))) return join(d, name);
  }
  throw new Error("Higgsfield CLI not found. Install: npm install -g @higgsfield/cli, then run: higgsfield auth login");
}

const MODEL_RE = /^[a-z0-9][a-z0-9_.-]{1,60}$/;
const PARAM_RE = /^[a-z][a-z0-9_]{0,40}$/;

function hf(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    let bin: string;
    try {
      bin = hfBinary();
    } catch (e) {
      return reject(e);
    }
    const p = spawn(bin, [...args, "--no-color"], { cwd: tmpdir(), shell: false, windowsHide: true, env: scrubbedEnv(), stdio: ["ignore", "pipe", "pipe"], signal });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    const t = setTimeout(() => p.kill(), timeoutMs);
    p.on("error", () => reject(new Error("Higgsfield CLI not found. Install: npm install -g @higgsfield/cli, then run: higgsfield auth login")));
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out, err });
    });
  });
}

function explain(r: { out: string; err: string }): string {
  const t = `${r.err}\n${r.out}`;
  if (/not authenticated|session expired|unauthori[sz]ed|login/i.test(t)) return "Higgsfield is not signed in. Run in a terminal: higgsfield auth login";
  if (/no workspace selected/i.test(t)) return "Pick a Higgsfield workspace once: higgsfield workspace list, then higgsfield workspace set <id>";
  if (/insufficient|not enough credits|balance/i.test(t)) return "Not enough Higgsfield credits for this job.";
  return t.trim().slice(-600);
}

/** Build `--key=value` pairs. The `=` form keeps a prompt that starts with "-" from being read as a flag. */
function params(model: string, prompt: string, extra: Record<string, string | number | undefined>) {
  if (!MODEL_RE.test(model)) throw new Error(`Invalid Higgsfield model name "${model}".`);
  const args = [model, `--prompt=${prompt}`];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === "") continue;
    if (!PARAM_RE.test(k)) throw new Error(`Invalid parameter name "${k}".`);
    args.push(`--${k}=${v}`);
  }
  return args;
}

function findNumber(v: unknown, keys: RegExp): number | undefined {
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (keys.test(k) && typeof x === "number") return x;
      const deep = findNumber(x, keys);
      if (deep !== undefined) return deep;
    }
  }
  return undefined;
}

function findUrls(v: unknown, acc: string[] = []): string[] {
  if (typeof v === "string" && /^https:\/\/\S+$/.test(v) && /\.(png|jpe?g|webp|gif|mp4|webm|mov)(\?|$)/i.test(v)) acc.push(v);
  else if (Array.isArray(v)) v.forEach((x) => findUrls(x, acc));
  else if (v && typeof v === "object") Object.values(v).forEach((x) => findUrls(x, acc));
  return acc;
}

function parseJson(out: string): unknown {
  try {
    return JSON.parse(out);
  } catch {
    // some commands print a JSON object per line
    const lines = out.split(/\r?\n/).filter((l) => l.trim().startsWith("{") || l.trim().startsWith("["));
    return lines.map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    });
  }
}

export const _test = { params, findUrls, findNumber };

/** Higgsfield result links are public signed CDN URLs: plain https download, no cookies involved. */
export const MAX_MEDIA_BYTES = 500 * 1024 * 1024;

export async function downloadHttps(url: string, signal?: AbortSignal): Promise<Buffer> {
  let current = url;
  // Follow redirects by hand so every hop is re-checked (https, public host).
  for (let hop = 0; hop < 5; hop++) {
    assertPublicHttps(current);
    const res = await fetch(current, { redirect: "manual", signal: signal ?? AbortSignal.timeout(5 * 60_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location")!, current).toString();
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Media download failed with HTTP ${res.status}`);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > MAX_MEDIA_BYTES) throw new Error("Media larger than 500 MB, refusing.");
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  throw new Error("Too many redirects.");
}

/** Starts the official OAuth login; the CLI opens the browser and the user signs in there. */
export function higgsfieldLogin() {
  const p = spawn(hfBinary(), ["auth", "login"], { cwd: tmpdir(), shell: false, detached: true, stdio: "ignore", windowsHide: false, env: scrubbedEnv() });
  p.unref();
}

export async function higgsfieldStatus(): Promise<{ signedIn: boolean; detail: string; credits?: number }> {
  try {
    // Bare `account` only prints help (exit 0), so ask for `account status` explicitly.
    const r = await hf(["account", "status", "--json"], 30_000);
    if (r.code !== 0 || /^\s*Usage:/m.test(r.out)) return { signedIn: false, detail: explain(r) };
    return { signedIn: true, detail: "signed in", credits: findNumber(parseJson(r.out), /balance|credits?/i) };
  } catch (e) {
    return { signedIn: false, detail: (e as Error).message };
  }
}

export async function higgsfieldCost(model: string, prompt: string, extra: Record<string, string | number | undefined>): Promise<number> {
  const r = await hf(["generate", "cost", ...params(model, prompt, extra), "--json"], 60_000);
  if (r.code !== 0) throw new Error(explain(r));
  const n = findNumber(parseJson(r.out), /credits?|cost|price|amount/i);
  if (n === undefined) throw new Error("Could not read the credit cost from Higgsfield. Nothing was generated.");
  return n;
}

export async function higgsfieldGenerate(
  model: string,
  prompt: string,
  extra: Record<string, string | number | undefined>,
  maxCredits: number,
  signal?: AbortSignal,
): Promise<{ urls: string[]; credits: number }> {
  const credits = await higgsfieldCost(model, prompt, extra);
  if (credits > maxCredits) throw new Error(`This would use ${credits} Higgsfield credits, more than max_credits=${maxCredits}. Nothing was generated.`);
  const r = await hf(["generate", "create", ...params(model, prompt, extra), "--wait", "--wait-timeout=20m", "--json"], 22 * 60_000, signal);
  if (r.code !== 0) throw new Error(explain(r));
  const urls = [...new Set(findUrls(parseJson(r.out)))];
  if (!urls.length) throw new Error("Higgsfield finished but returned no media URL.");
  return { urls, credits };
}
