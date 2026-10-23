import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Browser } from "./browser.js";
import { CHROME_MISSING, readState, STRIP_NOTICE, writeState, type Config } from "./config.js";
import { launchArgs } from "./install.js";
import { chatgptStatus } from "./providers/chatgpt.js";
import { codexStatus } from "./providers/codex.js";
import { flowStatus } from "./providers/google.js";
import { higgsfieldStatus } from "./providers/higgsfield.js";
import { redact } from "./safety.js";
import { ffmpegPath } from "./optimize.js";

const row = (label: string, value: string) => `  ${label.padEnd(18)}${value}`;
const say = (s = "") => process.stdout.write(redact(s) + "\n");

function ffmpegOk(): boolean {
  try {
    return spawnSync(ffmpegPath(), ["-version"], { cwd: tmpdir(), shell: false, windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

/**
 * `node dist/src/index.js setup`: check prerequisites, open the sign-in window, wait for it to close,
 * show which accounts are ready and print the config for each MCP client. Runs before any client is set up.
 */
export async function runSetup(cfg: Config, browser: Browser, version: string, argv: string[]) {
  const noLogin = argv.includes("--no-login");
  const sIdx = argv.indexOf("--services");
  const services = sIdx >= 0 ? (argv[sIdx + 1] ?? "").split(",").filter(Boolean) : ["chatgpt", "google"];

  say(`no-api-media-mcp ${version} setup`);
  say();
  say("Checking prerequisites");
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  say(row("Node", nodeMajor >= 22 ? `ok (${process.versions.node})` : `too old (${process.versions.node}), need 22+`));
  say(row("Google Chrome", existsSync(cfg.chromePath) ? `ok  ${cfg.chromePath}` : "missing"));
  say(row("ffmpeg", ffmpegOk() ? "ok" : "missing (media_optimize needs it: winget install Gyan.FFmpeg / brew install ffmpeg)"));
  const codex = await codexStatus();
  say(row("Codex CLI", codex.signedIn ? "ok, signed in with ChatGPT" : `optional: ${codex.detail}`));
  const hf = await higgsfieldStatus();
  say(row("Higgsfield CLI", hf.signedIn ? "ok, signed in" : `optional: ${hf.detail}`));
  say();
  say(row("Private profile", cfg.profileDir));
  say(row("Output root", cfg.outputRoots.join(", ")));
  say(row("Strip metadata", cfg.stripAiMetadata ? "on (media_optimize output; config set strip_ai_metadata false to keep)" : "off"));
  if (!readState(cfg).stripNoticeShown) {
    say();
    say(STRIP_NOTICE);
    writeState(cfg, { stripNoticeShown: "1" });
  }
  say();

  if (!noLogin && !cfg.chromePath) {
    say(CHROME_MISSING);
    say();
  } else if (!noLogin) {
    say(`Opening Chrome so you can sign in to: ${services.join(", ")}.`);
    say("Use the Google account that has your AI plan. Close the whole window when you're done.");
    const urls = services.map((s) => (s === "chatgpt" ? "https://chatgpt.com/" : s === "google" ? "https://accounts.google.com/ServiceLogin?continue=https://flow.google.com/" : "")).filter(Boolean);
    await browser.close();
    await new Promise<void>((resolve) => {
      const p = spawn(cfg.chromePath, [`--user-data-dir=${cfg.profileDir}`, "--no-first-run", "--no-default-browser-check", ...urls], {
        cwd: tmpdir(),
        stdio: "ignore",
        shell: false,
      });
      p.on("exit", () => resolve());
      p.on("error", () => resolve());
    });
    say();
  }

  say("Accounts");
  let page;
  try {
    page = await browser.page();
  } catch (e) {
    say(row("browser", (e as Error).message));
    page = undefined;
  }
  if (page) try {
    const c = await chatgptStatus(page).catch((e) => ({ signedIn: false, detail: (e as Error).message }));
    say(row("chatgpt", c.signedIn ? "signed in" : `not signed in (${c.detail})`));
    const g = await flowStatus(page, cfg.googleEmail).then(
      (s) => `signed in, ${s.tier}, ${s.account}${s.lowCredits ? ", low on Flow credits" : ""}`,
      (e) => `not signed in (${(e as Error).message})`,
    );
    say(row("google", g));
  } finally {
    await page.close().catch(() => undefined);
    await browser.close();
  }

  say();
  // Always this exact copy by its absolute path, never `npx no-api-media-mcp@latest`: that would fetch and run
  // whatever is published under the name on every start. Written unredacted, since the path has to be usable.
  // Forward slashes on Windows: Node takes them, and they survive being pasted into Git Bash as well as PowerShell.
  const launch = launchArgs();
  launch.args = launch.args.map((x) => (process.platform === "win32" ? x.replace(/\\/g, "/") : x));
  const quoted = launch.args.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" ");
  say("Add to Claude Code:");
  process.stdout.write(`  claude mcp add --scope user no-api-media -- ${launch.command} ${quoted}\n`);
  say("Claude Desktop / Cursor: add this under \"mcpServers\" in the MCP config:");
  process.stdout.write(`  "no-api-media": ${JSON.stringify({ command: launch.command, args: launch.args })}\n`);
  say();
  say('Done. First prompt to try: "Use no-api-media to make a 16:9 hero image of a quiet sunrise over hills with flow"');
}
