import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";
import { assertNoWall, fetchMedia, sleep, StopWaiting, waitFor } from "../browser.js";
import { log, maskAccount } from "../safety.js";

const FLOW = "https://flow.google.com";
const GEMINI = "https://gemini.google.com";
// Generated media is served from Google's own hosts; anything else on the page is ignored.
const GOOGLE_MEDIA_HOSTS = ["googleusercontent.com", "google.com", "gstatic.com", "ggpht.com", "googleapis.com", "flow-content.google"];

export type FlowModel = "nano-banana-2" | "veo-lite" | "veo-fast" | "veo-quality" | "omni-flash";
export type Aspect = "16:9" | "4:3" | "1:1" | "3:4" | "4:5" | "9:16";

/** "nano-banana-2" is the API name for "the image model"; which Nano Banana version that is gets read from Flow's menu. */
export function isImageModel(model: FlowModel): boolean {
  return model === "nano-banana-2";
}

/**
 * Which family each API model name means. Flow renames and replaces models (it dropped "Nano Banana 2"),
 * so the server reads the menu and picks by family instead of a pinned label: the newest matching
 * version, a full model over a "Lite" one when both exist. NOAPI_FLOW_IMAGE_MODEL pins an exact label.
 */
const FAMILY: Record<FlowModel, { family: RegExp; variant?: RegExp }> = {
  "nano-banana-2": { family: /nano\s*banana/i },
  "veo-lite": { family: /\bveo\b/i, variant: /\blite\b/i },
  "veo-fast": { family: /\bveo\b/i, variant: /\bfast\b/i },
  "veo-quality": { family: /\bveo\b/i, variant: /\bquality\b/i },
  "omni-flash": { family: /\bomni\b/i, variant: /\bflash\b/i },
};

const version = (label: string) => Number(label.match(/(\d+(?:\.\d+)?)/)?.[1] ?? 0);

/** Pure: the menu label to click for this model, or undefined when the family is gone. */
export function pickModelLabel(labels: string[], model: FlowModel, pinned?: string): string | undefined {
  const clean = labels.map((l) => l.trim()).filter(Boolean);
  if (pinned) return clean.find((l) => l.toLowerCase().includes(pinned.toLowerCase()));
  const { family, variant } = FAMILY[model];
  let pool = clean.filter((l) => family.test(l) && (!variant || variant.test(l)));
  if (!variant) {
    const full = pool.filter((l) => !/\blite\b/i.test(l));
    if (full.length) pool = full;
  }
  return pool.sort((a, b) => version(b) - version(a))[0];
}

async function accountLabel(page: Page): Promise<string> {
  return (
    (await page
      .locator('[aria-label^="Google Account"]')
      .first()
      .getAttribute("aria-label")
      .catch(() => "")) ?? ""
  );
}

/**
 * Several Google accounts can be signed in at once. Find the /u/N slot that belongs to the wanted email
 * by reading the account button on the page. The email itself never goes into a URL, and only a masked
 * form of it is ever returned (never the person's display name).
 */
export async function googleSlot(page: Page, base: string, email?: string): Promise<{ slot: number; account: string }> {
  for (let n = 0; n < 6; n++) {
    await page.goto(`${base}/u/${n}/${base === GEMINI ? "app" : ""}`, { waitUntil: "domcontentloaded" });
    await sleep(2500);
    await assertNoWall(page);
    const label = await accountLabel(page);
    if (!label) {
      // Slot 0 empty means nobody is signed in at all; don't walk the other five slots.
      if (n === 0) break;
      continue;
    }
    if (!email || label.toLowerCase().includes(email.toLowerCase())) return { slot: n, account: maskAccount(label) };
  }
  throw new Error(email ? "That Google account is not signed in to the no-api-media profile. Run accounts_login." : "No Google account signed in. Run accounts_login.");
}

export async function flowStatus(page: Page, email?: string) {
  const { slot, account } = await googleSlot(page, FLOW, email);
  const body = await page.locator("body").innerText();
  const tier = (await page.locator("text=/^(PRO|ULTRA|PLUS)$/").first().innerText().catch(() => "")) || "unknown";
  return { slot, account, tier, lowCredits: /running low on Google Flow credits/i.test(body) };
}

async function openProject(page: Page, slot: number, savedUrl?: string): Promise<string> {
  if (savedUrl && savedUrl.startsWith(`${FLOW}/u/${slot}/project/`)) {
    await page.goto(savedUrl, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    if (page.url().includes("/project/")) return page.url().split("?")[0];
  }
  await page.goto(`${FLOW}/u/${slot}/`, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  await page.getByRole("button", { name: "New project" }).first().click();
  await page.waitForURL(/\/project\//, { timeout: 30_000 });
  await sleep(2000);
  return page.url().split("?")[0];
}

async function configure(page: Page, mode: "Image" | "Video", model: FlowModel, aspect: Aspect, count: 1 | 2 | 3 | 4) {
  await page.getByRole("button", { name: "Settings trigger" }).click();
  await sleep(600);
  await page.getByRole("radio", { name: mode }).click();
  await sleep(400);
  // A missing aspect used to be skipped silently, so the image came out in whatever shape was last used.
  const aspectRadio = page.getByRole("radio", { name: aspect, exact: true });
  if (!(await aspectRadio.count())) {
    const offered = (await page.getByRole("radio").allInnerTexts().catch(() => [])).map((t) => t.trim()).filter((t) => /^\d+:\d+$/.test(t));
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(`Flow doesn't offer the ${aspect} aspect${offered.length ? ` (it offers ${offered.join(", ")})` : ""}. Pick one of those, or use codex for ${aspect}.`);
  }
  await aspectRadio.click();
  await page.getByRole("button", { name: "Select model family" }).click();
  await sleep(400);
  const labels = await page.getByRole("menuitem").allInnerTexts().catch(() => [] as string[]);
  const pinned = isImageModel(model) ? process.env.NOAPI_FLOW_IMAGE_MODEL : undefined;
  const label = pickModelLabel(labels, model, pinned);
  if (!label) {
    await page.keyboard.press("Escape").catch(() => undefined);
    throw new Error(`Flow has no ${pinned ? `"${pinned}"` : model} model right now. Its menu shows: ${labels.map((l) => l.trim()).filter(Boolean).join(", ") || "nothing readable"}.`);
  }
  await page.getByRole("menuitem").filter({ hasText: label }).first().click();
  await sleep(400);
  // Output count radios have no accessible name, only the visible text x1..x4. Match that exact text,
  // so a layout change can never make us click an aspect radio by mistake.
  const countRadio = page.locator('[role="radio"]').filter({ hasText: new RegExp(`^\\s*x${count}\\s*$`) });
  if (await countRadio.count()) await countRadio.first().click();
  await sleep(600);
  const cost = await page.locator("text=/^\\d+ credits?$/").first().innerText().catch(() => "");
  await page.keyboard.press("Escape");
  return Number(cost.match(/\d+/)?.[0] ?? NaN);
}

async function mediaKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ([...document.querySelectorAll("img")] as HTMLImageElement[])
      .filter((i) => i.naturalWidth >= 300)
      .map((i) => i.src.split("?")[0]),
  );
}

export async function flowQuote(page: Page, opts: { email?: string; model: FlowModel; aspect: Aspect; count: 1 | 2 | 3 | 4; project?: string }) {
  const st = await flowStatus(page, opts.email);
  const project = await openProject(page, st.slot, opts.project);
  const mode = isImageModel(opts.model) ? "Image" : "Video";
  const credits = await configure(page, mode, opts.model, opts.aspect, opts.count);
  return { ...st, project, credits };
}

/**
 * Generate in Flow and save through Flow's own Download menu, so the user gets the quality they pick
 * ("Original size" or an upscaled version) instead of a preview thumbnail.
 */
export async function flowGenerate(
  page: Page,
  opts: {
    email?: string;
    prompt: string;
    model: FlowModel;
    aspect: Aspect;
    count: 1 | 2 | 3 | 4;
    maxCredits: number;
    quality: "original" | "upscaled";
    project?: string;
    onTick?: (ms: number) => void;
  },
): Promise<{ files: Buffer[]; credits: number; project: string; account: string }> {
  const q = await flowQuote(page, opts);
  if (!Number.isFinite(q.credits)) throw new Error("Could not read the credit cost from Flow. Nothing was generated.");
  if (q.credits > opts.maxCredits) {
    throw new Error(`This would use ${q.credits} credits, more than max_credits=${opts.maxCredits}. Nothing was generated.`);
  }

  const before = new Set(await mediaKeys(page));
  const box = page.locator('[contenteditable="true"]').first();
  await box.click();
  await page.keyboard.insertText(opts.prompt);
  await sleep(500);
  await page.getByRole("button", { name: "Start generation" }).click();

  const isVideo = !isImageModel(opts.model);
  const fresh = await waitFor(
    async () => {
      const text = await page.locator("main").innerText().catch(() => "");
      if (/couldn.t generate|generation failed|try again later|violates|unable to generate/i.test(text)) {
        throw new StopWaiting("Flow reported a failed or blocked generation. Rephrase the prompt.");
      }
      // A progress readout (0-99%) means a tile is still rendering. 100% is shown on finished tiles.
      const busy = /(^|\s)\d{1,2}%(\s|$)/m.test(text);
      const newOnes = (await mediaKeys(page)).filter((k) => !before.has(k));
      return !busy && newOnes.length >= opts.count ? newOnes : undefined;
    },
    isVideo ? 12 * 60_000 : 4 * 60_000,
    5000,
    opts.onTick,
  );

  // Tag the "More options" button of each NEW tile, so an older tile can never be downloaded by mistake.
  const tagged = await page.evaluate((keys) => {
    let n = 0;
    for (const img of [...document.querySelectorAll("img")] as HTMLImageElement[]) {
      if (!keys.includes(img.src.split("?")[0])) continue;
      let el: HTMLElement | null = img;
      while (el && !el.querySelector('button[aria-label="More options"]')) el = el.parentElement;
      const btn = el?.querySelector('button[aria-label="More options"]');
      if (btn && !btn.hasAttribute("data-noapi-dl")) {
        btn.setAttribute("data-noapi-dl", String(n));
        img.setAttribute("data-noapi-tile", String(n));
        n++;
      }
    }
    return n;
  }, fresh);
  if (tagged < 1) throw new Error("Generated, but could not find the new tile's download menu. Flow's layout may have changed.");

  const files: Buffer[] = [];
  for (let i = 0; i < Math.min(tagged, opts.count); i++) {
    // The tile's buttons only appear on hover, like for a person using the page.
    const tile = page.locator(`[data-noapi-tile="${i}"]`);
    await tile.scrollIntoViewIfNeeded().catch(() => undefined);
    await tile.hover();
    await sleep(800);
    // Remember the tile's own media URL (the <video> that appears on hover, else the image) as a fallback.
    const direct = await tile.evaluate((img) => {
      let el: HTMLElement | null = img as HTMLElement;
      for (let k = 0; k < 8 && el; k++, el = el.parentElement) {
        const v = el.querySelector("video") as HTMLVideoElement | null;
        if (v && (v.currentSrc || v.src)) return v.currentSrc || v.src;
      }
      return (img as HTMLImageElement).src;
    });
    let got: Buffer | undefined;
    // "Original size" is exactly what the tile already shows, so fetch it directly. Going through Flow's
    // Download menu makes current Chrome crash under automation; keep that path only for upscaled files.
    if (opts.quality === "original" && direct) {
      got = await fetchMedia(page, direct, GOOGLE_MEDIA_HOSTS).catch((e) => {
        log(`flow: direct fetch failed for tile ${i}: ${(e as Error).message} (${direct.slice(0, 40)})`);
        return undefined;
      });
    }
    if (!got) try {
      await page.locator(`[data-noapi-dl="${i}"]`).click();
      await page.getByRole("menuitem", { name: "Download", exact: true }).click();
      await sleep(500);
      const items = page.getByRole("menuitem");
      const labels = await items.allInnerTexts();
      let idx = labels.findIndex((l) => /original size/i.test(l));
      if (opts.quality === "upscaled") {
        const up = labels.findIndex((l) => /1080p|2k/i.test(l) && /upscaled/i.test(l));
        const any = labels.findIndex((l) => /upscaled/i.test(l));
        idx = up >= 0 ? up : any >= 0 ? any : idx;
      }
      if (idx < 0) throw new Error("download menu changed");
      const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 5 * 60_000 }), items.nth(idx).click()]);
      const path = await dl.path();
      if (path) got = readFileSync(path);
      await dl.delete().catch(() => undefined);
    } catch {
      // Flow sometimes hands the download to a short-lived popup and Playwright loses it.
      await page.keyboard.press("Escape").catch(() => undefined);
    }
    if (!got) {
      if (!direct || (opts.quality === "upscaled" && !isVideo)) {
        throw new Error("Generated, but Flow's download didn't complete. The files are in your Flow project; try again or download them there.");
      }
      got = await fetchMedia(page, direct, GOOGLE_MEDIA_HOSTS);
    }
    files.push(got);
    await sleep(1500);
  }
  return { files, credits: q.credits, project: q.project, account: q.account };
}

/** Gemini app images (Nano Banana) as a second Google route. */
export async function geminiImage(page: Page, prompt: string, email?: string, onTick?: (ms: number) => void): Promise<{ data: Buffer; account: string }> {
  const { account } = await googleSlot(page, GEMINI, email);
  const box = page.locator('rich-textarea [contenteditable="true"], [contenteditable="true"]').first();
  await box.waitFor({ state: "visible" });
  const before = new Set(
    await page.evaluate(() => ([...document.querySelectorAll("img")] as HTMLImageElement[]).map((i) => i.src.split("?")[0])),
  );
  await box.click();
  await page.keyboard.insertText(`Generate an image: ${prompt}`);
  await sleep(400);
  await page.keyboard.press("Enter");

  const src = await waitFor(
    async () =>
      page.evaluate((seen) => {
        const imgs = ([...document.querySelectorAll("img")] as HTMLImageElement[]).filter(
          (i) => i.complete && i.naturalWidth >= 512 && !seen.includes(i.src.split("?")[0]),
        );
        return imgs.length ? imgs[imgs.length - 1].src : "";
      }, [...before]),
    4 * 60_000,
    3000,
    onTick,
  );
  await sleep(2500);
  return { data: await fetchMedia(page, src, GOOGLE_MEDIA_HOSTS), account };
}
