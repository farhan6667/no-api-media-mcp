import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir, platform } from "node:os";
import { join } from "node:path";
import { env, extraBinDirs, loadConfig, npmGlobalRoots, readState, scrubbedEnv, writeState } from "../config.js";

/**
 * Codex CLI signed in with a ChatGPT plan has a built-in image tool, no API key needed.
 * - No shell anywhere, and the binary is found without running npm (see npmGlobalRoots).
 * - API-key variables are stripped from the child env and ChatGPT login is forced, so a
 *   generation can never be billed to the paid API by accident.
 * - Codex gets write access only to a throwaway temp folder, with sandbox network off.
 */
export const CODEX_SAFETY_ARGS = [
  "-c", 'forced_login_method="chatgpt"',
  "-c", "sandbox_workspace_write.network_access=false",
  "-c", 'shell_environment_policy.inherit="none"',
];

function codexCommand(): { cmd: string; pre: string[] } {
  const custom = env("CODEX_JS");
  if (custom && existsSync(custom)) return { cmd: process.execPath, pre: [custom] };
  for (const root of npmGlobalRoots()) {
    const js = join(root, "@openai", "codex", "bin", "codex.js");
    if (existsSync(js)) return { cmd: process.execPath, pre: [js] };
  }
  if (platform() !== "win32") {
    for (const d of extraBinDirs()) {
      const bin = join(d, "codex");
      if (existsSync(bin)) return { cmd: bin, pre: [] };
    }
  }
  throw new Error("Codex CLI not found. Install it with: npm install -g @openai/codex, then run: codex login");
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number, signal?: AbortSignal): Promise<{ code: number; out: string }> {
  return new Promise((resolve, reject) => {
    // stdin must be closed: with a pipe open, `codex exec` waits to read extra prompt text from it.
    const p = spawn(cmd, args, { cwd, shell: false, windowsHide: true, env: scrubbedEnv(), stdio: ["ignore", "pipe", "pipe"], signal });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => {
      p.kill();
      reject(new Error("Codex timed out"));
    }, timeoutMs);
    p.on("error", (e) => {
      clearTimeout(t);
      reject(e.name === "AbortError" ? new Error("Cancelled") : e);
    });
    p.on("close", (code) => {
      clearTimeout(t);
      resolve({ code: code ?? 1, out: out.slice(-4000) });
    });
  });
}


const MAX_GENERATED_BYTES = 50 * 1024 * 1024;

/**
 * Newer Codex versions keep the picture in their own folder (`<codex home>/generated_images/<session>/`) and refuse
 * to copy it into the sandbox. So if nothing arrived in our folder, take the newest image that Codex wrote after
 * this run started. Only that folder, only picture files, only files newer than the start time, and the caller
 * still checks the bytes. A one-job-at-a-time gate keeps another of our own runs from racing it.
 */
export function findGeneratedImage(codexHome: string, sinceMs: number): string | undefined {
  const root = join(codexHome, "generated_images");
  if (!existsSync(root)) return undefined;
  let best: { file: string; mtime: number } | undefined;
  try {
    for (const session of readdirSync(root)) {
      const dir = join(root, session);
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue; // not a folder
      }
      for (const name of names) {
        if (!/\.(png|jpe?g|webp)$/i.test(name)) continue;
        const file = join(dir, name);
        const st = statSync(file);
        if (!st.isFile() || st.size === 0 || st.size > MAX_GENERATED_BYTES) continue;
        if (st.mtimeMs >= sinceMs && (!best || st.mtimeMs > best.mtime)) best = { file, mtime: st.mtimeMs };
      }
    }
  } catch {
    return undefined;
  }
  return best?.file;
}

function codexHome(): string {
  return env("CODEX_HOME") ?? join(homedir(), ".codex");
}

/**
 * `codex login status` only reads the local login file, so it still says "Logged in using ChatGPT" after the
 * token was revoked or expired (issue #11). When a real run is refused for login reasons we remember when, and
 * the status reports "not signed in" until the login file is newer than that refusal (a fresh `codex login`).
 */
export function staleLogin(failedAtMs: number, loginFileMtimeMs: number | undefined): boolean {
  return failedAtMs > 0 && (loginFileMtimeMs === undefined || failedAtMs > loginFileMtimeMs);
}

function loginFileMtime(): number | undefined {
  try {
    return statSync(join(codexHome(), "auth.json")).mtimeMs;
  } catch {
    return undefined;
  }
}

function rememberAuthFailure(failedAt: number): void {
  try {
    writeState(loadConfig(), { codexAuthFailedAt: String(failedAt) });
  } catch {
    /* the status falls back to the CLI's own answer */
  }
}

export async function codexStatus(): Promise<{ signedIn: boolean; detail: string }> {
  try {
    const { cmd, pre } = codexCommand();
    const r = await run(cmd, [...pre, ...CODEX_SAFETY_ARGS, "login", "status"], tmpdir(), 30_000);
    const last = r.out.trim().split("\n").at(-1) ?? "";
    const signedIn = /using ChatGPT/i.test(r.out);
    let failedAt = 0;
    try {
      failedAt = Number(readState(loadConfig()).codexAuthFailedAt ?? 0) || 0;
    } catch {
      failedAt = 0;
    }
    if (signedIn && staleLogin(failedAt, loginFileMtime())) {
      return {
        signedIn: false,
        detail: `The Codex CLI still shows a login, but its last image run on ${new Date(failedAt).toISOString()} was refused (the sign-in expired or was revoked). Run in a terminal: codex login`,
      };
    }
    return { signedIn, detail: /api key/i.test(last) ? "Signed in with an API key. Run `codex login` and choose ChatGPT." : last };
  } catch (e) {
    return { signedIn: false, detail: (e as Error).message };
  }
}

/** The argument list for `codex exec`. The prompt comes before -i: --image takes any number of files, so after it a prompt would be swallowed as one. */
export function codexExecArgs(work: string, task: string, referenceImages: string[] = []): string[] {
  return ["exec", "-C", work, "-s", "workspace-write", "--skip-git-repo-check", task, ...referenceImages.flatMap((f) => ["-i", f])];
}

export async function codexImage(prompt: string, size?: string, signal?: AbortSignal, referenceImages: string[] = []): Promise<{ data: Buffer; note: string }> {
  const st = await codexStatus();
  if (!st.signedIn) throw new Error(`Codex must be signed in with ChatGPT (not an API key). ${st.detail}`);
  const { cmd, pre } = codexCommand();
  const work = mkdtempSync(join(tmpdir(), "noapi-codex-"));
  const startedAt = Date.now() - 2000;
  try {
    const task =
      `Use your built-in image generation tool to create exactly one image${size ? ` (${size})` : ""}. ` +
      `Save it in the current directory as out.png if the tool allows it, and if it saves the file somewhere else, just leave it there and say so. ` +
      `Do not write or run scripts, do not use any API key, do not read or touch anything outside this directory. ` +
      (referenceImages.length ? `The attached ${referenceImages.length === 1 ? "image is a reference" : "images are references"} supplied by the owner of the pictured person for this request. Follow the description below for what to keep and what to change. ` : "") +
      `Image description: ${prompt}`;
    const r = await run(
      cmd,
      [...pre, ...CODEX_SAFETY_ARGS, ...codexExecArgs(work, task, referenceImages)],
      work,
      8 * 60_000,
      signal,
    );
    const file = readdirSync(work).find((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (!file) {
      const fallback = findGeneratedImage(codexHome(), startedAt);
      if (fallback) return { data: readFileSync(fallback), note: "Codex CLI built-in image tool (ChatGPT plan)" };
      if (/out of credits|usage limit|rate limit|quota/i.test(r.out)) {
        throw new Error("Your ChatGPT plan's Codex limit is used up for now. Try provider 'flow' (usually 0 credits) or 'chatgpt', or wait for the limit to reset.");
      }
      if (/not logged in|login required|unauthorized|refresh token|token (?:has )?(?:expired|been revoked)|\b401\b/i.test(r.out)) {
        rememberAuthFailure(Date.now());
        throw new Error("Codex is not signed in. Run in a terminal: codex login");
      }
      throw new Error(`Codex did not produce an image. Last output: ${r.out.slice(-600)}`);
    }
    return { data: readFileSync(join(work, file)), note: "Codex CLI built-in image tool (ChatGPT plan)" };
  } finally {
    // Codex's Windows sandbox can hold the folder for a moment after exit.
    try {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    } catch {
      /* leftover temp folder, harmless */
    }
  }
}
