import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import type { Config } from "./config.js";
import { assertPublicHttps, log } from "./safety.js";

/**
 * The server never sees a password. The user signs in once, by hand, in a dedicated Chrome profile
 * that lives in ~/.no-api-media/chrome-profile (outside every repo). Later the server reopens that
 * same profile. Playwright talks to Chrome over a pipe, not a TCP debugging port, so no other process
 * on the machine can attach to the logged-in browser.
 */
export class Browser {
  private ctx?: BrowserContext;
  private idleTimer?: NodeJS.Timeout;
  private open = 0;

  constructor(private cfg: Config) {
    mkdirSync(cfg.profileDir, { recursive: true });
  }

  private profileLocked(): boolean {
    return ["SingletonLock", "SingletonCookie", "lockfile"].some((f) => existsSync(join(this.cfg.profileDir, f)));
  }

  private async context(): Promise<BrowserContext> {
    if (this.ctx) return this.ctx;
    try {
      this.ctx = await chromium.launchPersistentContext(this.cfg.profileDir, {
        executablePath: this.cfg.chromePath,
        headless: false,
        viewport: null,
        // Downloads go to a Playwright temp folder and are moved by the server, never to ~/Downloads.
        acceptDownloads: true,
        args: ["--no-first-run", "--no-default-browser-check", "--window-size=1400,900"],
      });
    } catch (e) {
      if (this.profileLocked()) {
        throw new Error("The no-api-media Chrome profile is already open (the login window, or another copy of this server). Close it and try again.");
      }
      throw e;
    }
    this.ctx.on("close", () => (this.ctx = undefined));
    return this.ctx;
  }

  /**
   * Close the automated browser after 10 idle minutes so a logged-in window doesn't sit open forever.
   * The timer only runs while no page is open, so a long video job is never cut off half way.
   */
  private armIdle() {
    clearTimeout(this.idleTimer);
    if (this.open > 0) return;
    this.idleTimer = setTimeout(() => void this.close(), 10 * 60_000);
    this.idleTimer.unref();
  }

  /** A page for one job. Closing it (or aborting `signal`) releases it. */
  async page(signal?: AbortSignal): Promise<Page> {
    if (signal?.aborted) throw new Error("Cancelled");
    clearTimeout(this.idleTimer);
    const ctx = await this.context();
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

  async close() {
    clearTimeout(this.idleTimer);
    const c = this.ctx;
    this.ctx = undefined;
    this.open = 0;
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
