import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import { env, extraBinDirs, npmGlobalRoots, scrubbedEnv } from "../config.js";

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

export async function codexStatus(): Promise<{ signedIn: boolean; detail: string }> {
  try {
    const { cmd, pre } = codexCommand();
    const r = await run(cmd, [...pre, ...CODEX_SAFETY_ARGS, "login", "status"], tmpdir(), 30_000);
    const last = r.out.trim().split("\n").at(-1) ?? "";
    return { signedIn: /using ChatGPT/i.test(r.out), detail: /api key/i.test(last) ? "Signed in with an API key. Run `codex login` and choose ChatGPT." : last };
  } catch (e) {
    return { signedIn: false, detail: (e as Error).message };
  }
}

export async function codexImage(prompt: string, size?: string, signal?: AbortSignal): Promise<{ data: Buffer; note: string }> {
  const st = await codexStatus();
  if (!st.signedIn) throw new Error(`Codex must be signed in with ChatGPT (not an API key). ${st.detail}`);
  const { cmd, pre } = codexCommand();
  const work = mkdtempSync(join(tmpdir(), "noapi-codex-"));
  try {
    const task =
      `Use your built-in image generation tool to create exactly one image${size ? ` (${size})` : ""}. ` +
      `Save it in the current directory as out.png. Do not write or run scripts, do not use any API key, ` +
      `do not read or touch anything outside this directory. Image description: ${prompt}`;
    const r = await run(
      cmd,
      [...pre, ...CODEX_SAFETY_ARGS, "exec", "-C", work, "-s", "workspace-write", "--skip-git-repo-check", task],
      work,
      8 * 60_000,
      signal,
    );
    const file = readdirSync(work).find((f) => /\.(png|jpe?g|webp)$/i.test(f));
    if (!file) {
      if (/out of credits|usage limit|rate limit|quota/i.test(r.out)) {
        throw new Error("Your ChatGPT plan's Codex limit is used up for now. Try provider 'flow' (usually 0 credits) or 'chatgpt', or wait for the limit to reset.");
      }
      if (/not logged in|login required|unauthorized/i.test(r.out)) throw new Error("Codex is not signed in. Run in a terminal: codex login");
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
