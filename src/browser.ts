import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser as ChromiumBrowser, type BrowserContext, type Page } from "playwright-core";
import type { Config } from "./config.js";
import { aheadOf, clearHost, formatEta, hostAlive, joinQueue, leaveQueue, markHost, waiting } from "./queue.js";
import { readReliability, typicalBrowserJobMs } from "./reliability.js";
import { assertPublicHttps, log } from "./safety.js";

/**
 * The server never sees a password. The user signs in once, by hand, in a dedicated Chrome profile
 * that lives in ~/.no-api-media/chrome-profile (outside every repo). Later the server reopens that
 * same profile. With share_browser off, Playwright talks to Chrome over a pipe only, not a TCP debugging
 * port, so no other process on the machine can attach to the logged-in browser.
 *
 * Several Claude sessions can have this server running at once, all pointing at that one profile, and
 * Chrome lets only one process hold a profile at a time. Two ways to handle that:
 *
 * - share_browser on (the default, since this runs on the user's own machine): the browser is launched
 *   with a loopback-only devtools port (Chrome writes it to
 *   DevToolsActivePort in the profile folder) and a second session joins that same browser over CDP as
 *   another tab, so both jobs run side by side. The cost: while the browser is open, any local process
 *   could attach to that port, which is why it's worth turning off on a shared machine. A session that
 *   joined this way never shuts the shared browser down; only the one that launched it does, after it
 *   goes idle.
 * - share_browser off: a second session joins a small machine-wide queue and waits its turn, reporting
 *   its place and, once there's enough history, an estimate based on how long recent browser jobs
 *   actually took. The pipe-only guarantee above holds. The queue is also the fallback when sharing is on
 *   but the other browser can't be joined.
 */
const QUEUE_POLL_MS = 2500;
const STATUS_EVERY_MS = 10_000;
const QUEUE_MAX_MS = 20 * 60_000;

export class Browser {
  private ctx?: BrowserContext;
  private cdpBrowser?: ChromiumBrowser;
  private isHost = true;
  private idleTimer?: NodeJS.Timeout;
  private yieldTimer?: NodeJS.Timeout;
  private open = 0;
  /** Time the last page() call spent waiting for another session, so job timings can leave it out. */
  lastWaitMs = 0;

  constructor(private cfg: Config) {
    mkdirSync(cfg.profileDir, { recursive: true });
  }

  private profileLocked(): boolean {
    return ["SingletonLock", "SingletonCookie", "lockfile"].some((f) => existsSync(join(this.cfg.profileDir, f)));
  }

  private devtoolsPort(): number | undefined {
    try {
      const f = join(this.cfg.profileDir, "DevToolsActivePort");
      if (!existsSync(f)) return undefined;
      const port = Number(readFileSync(f, "utf8").split("\n")[0]);
      return Number.isInteger(port) && port > 0 ? port : undefined;
    } catch {
      return undefined;
    }
  }

  /** Attach to whichever session already has this profile open, as a second tab in the same browser. */
  private async tryJoin(): Promise<BrowserContext | undefined> {
    const port = this.devtoolsPort();
    if (!port) return undefined;
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 5000 });
      const ctx = browser.contexts()[0];
      if (!ctx) {
        await browser.close().catch(() => undefined);
        return undefined;
      }
      this.cdpBrowser = browser;
      this.isHost = false;
      return ctx;
    } catch {
      return undefined;
    }
  }

  private launchArgs(): string[] {
    const args = ["--no-first-run", "--no-default-browser-check", "--window-size=1400,900"];
    // Port 0: Chrome picks a free loopback port and writes it to DevToolsActivePort in the profile folder.
    if (this.cfg.shareBrowser) args.push("--remote-debugging-port=0");
    return args;
  }

  private async launch(): Promise<BrowserContext> {
    const ctx = await chromium.launchPersistentContext(this.cfg.profileDir, {
      executablePath: this.cfg.chromePath,
      headless: false,
      viewport: null,
      // Downloads go to a Playwright temp folder and are moved by the server, never to ~/Downloads.
      acceptDownloads: true,
      args: this.launchArgs(),
    });
    this.isHost = true;
    markHost(this.cfg.home);
    return ctx;
  }

  private adopt(ctx: BrowserContext): BrowserContext {
    this.ctx = ctx;
    const host = this.isHost;
    this.ctx.on("close", () => {
      this.ctx = undefined;
      if (host) clearHost(this.cfg.home);
    });
    return this.ctx;
  }

  private async context(signal?: AbortSignal, onStatus?: (msg: string) => void): Promise<BrowserContext> {
    this.lastWaitMs = 0;
    if (this.ctx) return this.ctx;

    if (this.cfg.shareBrowser && this.profileLocked()) {
      const shared = await this.tryJoin();
      if (shared) return this.adopt(shared);
    }

    try {
      return this.adopt(await this.launch());
    } catch (e) {
      if (!this.profileLocked()) throw e;
    }

    // Another session holds the profile. Line up and wait, saying where we are, instead of failing.
    const started = Date.now();
    const ticket = joinQueue(this.cfg.home, started);
    try {
      let lastPlace = 0;
      let lastSent = 0;
      let orphanChecks = 0;
      while (Date.now() - started < QUEUE_MAX_MS) {
        if (signal?.aborted) throw new Error("Cancelled");
        if (this.cfg.shareBrowser) {
          const shared = await this.tryJoin();
          if (shared) return this.adopt(shared);
        }
        const ahead = aheadOf(ticket);
        if (ahead === 0) {
          try {
            return this.adopt(await this.launch());
          } catch (e) {
            if (!this.profileLocked()) throw e;
          }
          // Locked, yet no copy of this server owns it: that's the sign-in window or a stray Chrome,
          // and waiting won't help. Checked over about ten seconds, so a session that is just starting isn't misread.
          orphanChecks = hostAlive(this.cfg.home) ? 0 : orphanChecks + 1;
          if (orphanChecks >= 4) {
            throw new Error("The no-api-media Chrome profile is already open, but not by another session of this server (probably the sign-in window or a leftover Chrome). Close it and try again.");
          }
        }
        const place = ahead + 1;
        const typical = typicalBrowserJobMs(readReliability(this.cfg.home));
        const eta = formatEta(typical === undefined ? undefined : typical * place);
        const msg =
          `The browser is busy with another no-api-media session. This job is number ${place} in line` +
          `, waited ${Math.round((Date.now() - started) / 1000)}s` +
          (eta ? `, ${eta} to go judging by recent jobs` : "") +
          (this.cfg.shareBrowser ? "." : ". Turn on share_browser to run sessions side by side instead.");
        if (place !== lastPlace || Date.now() - lastSent >= STATUS_EVERY_MS) {
          onStatus?.(msg);
          lastPlace = place;
          lastSent = Date.now();
        }
        await new Promise((r) => setTimeout(r, QUEUE_POLL_MS));
      }
      throw new Error(
        `Waited ${Math.round(QUEUE_MAX_MS / 60_000)} minutes for another no-api-media session to free the browser. ` +
          "If no other session is generating, a stray Chrome window may be holding the profile: close it and try again.",
      );
    } finally {
      leaveQueue(ticket);
      this.lastWaitMs = Date.now() - started;
    }
  }

  /**
   * Close the automated browser after 10 idle minutes so a logged-in window doesn't sit open forever.
   * The timer only runs while no page is open, so a long video job is never cut off half way. Only the
   * session that actually launched the browser is allowed to shut it down; a session that joined over
   * CDP just disconnects, leaving the browser running for whoever launched it (and anyone else sharing it).
   */
  private armIdle() {
    clearTimeout(this.idleTimer);
    clearInterval(this.yieldTimer);
    if (this.open > 0) return;
    this.idleTimer = setTimeout(() => void (this.isHost ? this.close() : this.disconnect()), 10 * 60_000);
    this.idleTimer.unref();
    // Without sharing, another session can only get the browser once we let go of it. So when we're
    // idle and somebody is waiting in the queue, hand it over now instead of after the 10 minutes.
    if (this.isHost && !this.cfg.shareBrowser) {
      this.yieldTimer = setInterval(() => {
        if (this.open === 0 && waiting(this.cfg.home) > 0) void this.close();
      }, QUEUE_POLL_MS);
      this.yieldTimer.unref();
    }
  }

  /** A page for one job. Closing it (or aborting `signal`) releases it. `onStatus` reports a join wait, if any. */
  async page(signal?: AbortSignal, onStatus?: (msg: string) => void): Promise<Page> {
    if (signal?.aborted) throw new Error("Cancelled");
    clearTimeout(this.idleTimer);
    clearInterval(this.yieldTimer);
    const ctx = await this.context(signal, onStatus);
    const p = await ctx.newPage();
    this.open++;
    p.setDefaultTimeout(30_000);
    const onAbort = () => void p.close().catch(() => undefined);
    signal?.addEventListener("abort", onAbort, { once: true });
    p.on("close", () => {
      signal?.removeEventListener("abort", onAbort);
      this.open = Math.max(0, this.open - 1);
      this.armIdle();
    });
    return p;
  }

  /** Drop our CDP connection without touching the shared browser: we never launched it, so we never close it. */
  private async disconnect() {
    clearTimeout(this.idleTimer);
    clearInterval(this.yieldTimer);
    const c = this.cdpBrowser;
    this.ctx = undefined;
    this.cdpBrowser = undefined;
    this.open = 0;
    this.isHost = true;
    await c?.close().catch(() => undefined);
  }

  async close() {
    // A session that joined someone else's browser must never close it for them.
    if (!this.isHost) return this.disconnect();
    clearTimeout(this.idleTimer);
    clearInterval(this.yieldTimer);
    clearHost(this.cfg.home);
    const c = this.ctx;
    this.ctx = undefined;
    this.cdpBrowser = undefined;
    this.open = 0;
    this.isHost = true;
    await c?.close().catch(() => undefined);
  }

  /**
   * Open plain Chrome (no automation attached at all) on the private profile so the user can sign in
   * themselves. Google and OpenAI see a normal browser; the server is not in the loop while they type.
   */
  async openForLogin(urls: string[]) {
    await this.close();
    const child = spawn(
      this.cfg.chromePath,
      [`--user-data-dir=${this.cfg.profileDir}`, "--no-first-run", "--no-default-browser-check", ...urls],
      { cwd: tmpdir(), detached: true, stdio: "ignore", shell: false },
    );
    child.unref();
    log("login window opened for", urls.map((u) => new URL(u).host).join(", "));
  }
}

export const MAX_PAGE_MEDIA_BYTES = 200 * 1024 * 1024;

/**
 * Download a media URL with the page's own cookies, without a Save dialog and without touching ~/Downloads.
 * `allowedHosts` keeps a hostile image on the page from making us send the user's cookies to another site:
 * every hop, including redirects, must stay on the provider's own hosts.
 */
export async function fetchMedia(page: Page, url: string, allowedHosts: string[]): Promise<Buffer> {
  if (url.startsWith("data:")) {
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  }
  if (url.startsWith("blob:")) {
    // blob: URLs belong to the page's own origin, so they can't point anywhere else.
    const b64 = await page.evaluate(async ({ u, max }) => {
      const buf = new Uint8Array(await (await fetch(u)).arrayBuffer());
      if (buf.length > max) throw new Error("too large");
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, { u: url, max: MAX_PAGE_MEDIA_BYTES });
    return Buffer.from(b64, "base64");
  }
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    assertPublicHttps(current, allowedHosts);
    const res = await page.context().request.get(current, { timeout: 120_000, maxRedirects: 0 });
    const loc = res.headers()["location"];
    if (res.status() >= 300 && res.status() < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    if (!res.ok()) throw new Error(`Media download failed with HTTP ${res.status()}`);
    const len = Number(res.headers()["content-length"] ?? 0);
    if (len > MAX_PAGE_MEDIA_BYTES) throw new Error("Media larger than 200 MB, refusing.");
    const body = await res.body();
    if (body.length > MAX_PAGE_MEDIA_BYTES) throw new Error("Media larger than 200 MB, refusing.");
    return body;
  }
  throw new Error("Too many redirects.");
}

export async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/** Throw this from a waitFor callback to stop waiting immediately (e.g. the site said "generation failed"). */
export class StopWaiting extends Error {}

/** Poll until fn returns a value or the deadline passes. Ordinary errors are treated as "not yet". */
export async function waitFor<T>(
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs: number,
  everyMs = 3000,
  onTick?: (elapsedMs: number) => void,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    let v: T | undefined | null | false;
    try {
      v = await fn();
    } catch (e) {
      if (e instanceof StopWaiting) throw e;
      if (/Target page, context or browser has been closed/i.test((e as Error).message)) throw new Error("Cancelled");
      v = undefined;
    }
    if (v) return v as T;
    const elapsed = Date.now() - start;
    onTick?.(elapsed);
    if (elapsed > timeoutMs) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`);
    await sleep(everyMs);
  }
}

/** Stop if the site shows a captcha, consent or sign-in wall. The user handles those, never the server. */
export async function assertNoWall(page: Page) {
  const text = (await page.locator("body").innerText().catch(() => "")).slice(0, 5000).toLowerCase();
  const url = page.url();
  if (/accounts\.google\.com\/(v3\/)?signin|auth\.openai\.com|\/auth\/login/.test(url)) {
    throw new Error("Not signed in. Run the accounts_login tool and sign in yourself in the window that opens.");
  }
  if (/verify you are human|unusual traffic|captcha|are you a robot|just a moment/.test(text)) {
    throw new Error("The site is asking for a human check. Open the login window with accounts_login, solve it yourself, then retry.");
  }
}
