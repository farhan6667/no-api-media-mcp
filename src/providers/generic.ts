import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Page } from "playwright-core";
import { assertNoWall, fetchMedia, sleep, waitFor } from "../browser.js";

/**
 * A chat-style AI site described in JSON instead of code: open a URL, type into a box, submit,
 * wait for a new large image or video to appear, save it. Most image/video chat sites fit this.
 *
 * Built-in specs ship with the server. Users can add their own in ~/.no-api-media/providers/*.json.
 * Specs are never read from the project folder, so a cloned repo can't plant a provider.
 */
export const SpecSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,30}$/),
  name: z.string().max(60),
  url: z.string().url().refine((u) => u.startsWith("https://"), "https only"),
  kinds: z.array(z.enum(["image", "video"])).min(1),
  input: z.string().max(300).describe("CSS selector of the prompt box"),
  submit: z.union([z.literal("enter"), z.string().max(300)]).default("enter"),
  promptTemplate: z
    .object({ image: z.string().max(300).optional(), video: z.string().max(300).optional() })
    .default({}),
  busy: z.string().max(300).optional().describe("Selector that exists while the answer is still generating"),
  loggedOut: z.string().max(300).optional().describe("Selector that only exists when signed out"),
  mediaHosts: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(10).optional().describe("Hosts generated media may come from. Default: the site's own domain."),
  minSize: z.number().int().min(128).max(4096).default(512),
  timeoutSeconds: z.number().int().min(30).max(1800).default(300),
  notes: z.string().max(300).optional(),
});
export type Spec = z.infer<typeof SpecSchema>;

export const BUILTIN_SPECS: Spec[] = [
  SpecSchema.parse({
    id: "grok",
    name: "Grok (grok.com)",
    url: "https://grok.com/",
    kinds: ["image", "video"],
    input: 'textarea, [contenteditable="true"]',
    submit: "enter",
    promptTemplate: { image: "Generate an image: {prompt}", video: "Generate a short video: {prompt}" },
    busy: 'button[aria-label*="Stop"]',
    loggedOut: 'a[href*="sign-in"], a[href*="/login"], button:has-text("Sign in")',
    timeoutSeconds: 600,
    mediaHosts: ["grok.com", "x.ai", "x.com", "twimg.com"],
    notes: "Image and video limits depend on your X / SuperGrok plan.",
  }),
];

export function loadSpecs(home: string): { specs: Spec[]; errors: string[] } {
  const specs = [...BUILTIN_SPECS];
  const errors: string[] = [];
  const dir = join(home, "providers");
  if (!existsSync(dir)) return { specs, errors };
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const s = SpecSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      const at = specs.findIndex((x) => x.id === s.id);
      at >= 0 ? (specs[at] = s) : specs.push(s);
    } catch (e) {
      errors.push(`${f}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  return { specs, errors };
}

export async function genericStatus(page: Page, spec: Spec) {
  await page.goto(spec.url, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  const out = spec.loggedOut ? await page.locator(spec.loggedOut).count() : 0;
  const box = await page.locator(spec.input).count();
  return { signedIn: out === 0 && box > 0, detail: out ? "sign-in link visible" : box ? "prompt box found" : "prompt box not found (selector may be outdated)" };
}

async function mediaSet(page: Page, min: number): Promise<string[]> {
  return page.evaluate((m) => {
    const imgs = ([...document.querySelectorAll("img")] as HTMLImageElement[])
      .filter((i) => i.complete && i.naturalWidth >= m)
      .map((i) => "img|" + i.src);
    const vids = ([...document.querySelectorAll("video")] as HTMLVideoElement[])
      .map((v) => v.currentSrc || v.src || v.querySelector("source")?.src || "")
      .filter(Boolean)
      .map((s) => "video|" + s);
    return [...imgs, ...vids];
  }, min);
}

/** The site's registrable domain (last two labels), e.g. "grok.com" for https://www.grok.com/. */
export function siteDomain(url: string): string {
  return new URL(url).hostname.split(".").slice(-2).join(".");
}

export async function genericGenerate(page: Page, spec: Spec, kind: "image" | "video", prompt: string, onTick?: (ms: number) => void): Promise<Buffer> {
  if (!spec.kinds.includes(kind)) throw new Error(`${spec.name} is not set up for ${kind}s.`);
  await page.goto(spec.url, { waitUntil: "domcontentloaded" });
  await sleep(3000);
  await assertNoWall(page);
  if (spec.loggedOut && (await page.locator(spec.loggedOut).count())) {
    throw new Error(`Not signed in to ${spec.name}. Run accounts_login with "${spec.id}" and sign in yourself.`);
  }

  const before = new Set(await mediaSet(page, spec.minSize));
  const box = page.locator(spec.input).first();
  await box.waitFor({ state: "visible", timeout: 30_000 });
  await box.click();
  const text = (spec.promptTemplate[kind] ?? "{prompt}").replace("{prompt}", prompt);
  await page.keyboard.insertText(text);
  await sleep(500);
  if (spec.submit === "enter") await page.keyboard.press("Enter");
  else await page.locator(spec.submit).first().click();

  const want = kind === "image" ? "img|" : "video|";
  const hit = await waitFor(
    async () => {
      const busy = spec.busy ? await page.locator(spec.busy).count() : 0;
      const fresh = (await mediaSet(page, spec.minSize)).filter((m) => m.startsWith(want) && !before.has(m));
      return !busy && fresh.length ? fresh[fresh.length - 1] : undefined;
    },
    spec.timeoutSeconds * 1000,
    4000,
    onTick,
  );
  // Let progressive previews settle into the final file.
  await sleep(4000);
  const settled = (await mediaSet(page, spec.minSize)).filter((m) => m.startsWith(want) && !before.has(m));
  const url = (settled.at(-1) ?? hit).slice(want.length);
  return fetchMedia(page, url, spec.mediaHosts ?? [siteDomain(spec.url)]);
}
