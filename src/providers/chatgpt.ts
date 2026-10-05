import type { Page } from "playwright-core";
import { assertNoWall, fetchMedia, sleep, StopWaiting, waitFor } from "../browser.js";

const HOME = "https://chatgpt.com/";
// Generated images are served from these hosts; anything else on the page is ignored.
const MEDIA_HOSTS = ["chatgpt.com", "oaiusercontent.com", "openai.com", "oaistatic.com"];

export async function chatgptStatus(page: Page): Promise<{ signedIn: boolean; detail: string }> {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });
  await sleep(2500);
  const login = await page.locator('[data-testid="login-button"], button:has-text("Log in")').count();
  const profile = await page.locator('[data-testid="accounts-profile-button"], button[aria-label="Open profile menu"]').count();
  return { signedIn: login === 0 && profile > 0, detail: login ? "Log in button visible" : profile ? "profile menu found" : "unknown page state" };
}

/**
 * Generate one image in a normal ChatGPT chat (temporary chats can't make images).
 * Returns the full-resolution file ChatGPT itself serves, fetched with the page's cookies.
 */
export async function chatgptImage(page: Page, prompt: string, aspect?: string, onTick?: (ms: number) => void): Promise<{ data: Buffer; note: string }> {
  await page.goto(HOME, { waitUntil: "domcontentloaded" });
  await assertNoWall(page);
  const editor = page.locator('#prompt-textarea, [contenteditable="true"]').first();
  await editor.waitFor({ state: "visible", timeout: 30_000 });
  await assertNoWall(page);

  const ask = `Create an image${aspect ? `, aspect ratio ${aspect}` : ""}. ${prompt}`;
  await editor.click();
  await page.keyboard.insertText(ask);
  await sleep(400);
  const send = page.locator('[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]').first();
  await send.click();

  // Wait for a generated image that has fully loaded and for the reply to stop streaming.
  const src = await waitFor(
    async () => {
      // Stop at once on an error banner, a limit message or a human check instead of waiting out the timeout.
      const text = (await page.locator("body").innerText().catch(() => "")).slice(-4000);
      if (/verify you are human|just a moment|are you a robot/i.test(text)) {
        throw new StopWaiting("chatgpt.com is asking for a human check (Cloudflare). This server won't solve it. Use provider 'codex' or 'flow', or sign in again with accounts_login.");
      }
      if (/unknown error|something went wrong|network error|an error occurred/i.test(text) && (await page.getByRole("button", { name: /retry|regenerate/i }).count())) {
        throw new StopWaiting("ChatGPT showed an error instead of an image (often its automation check). Try provider 'codex' or 'flow'.");
      }
      if (/reached (the|your) (image|daily|current) (generation )?limit|you've hit|try again (later|in)/i.test(text)) {
        throw new StopWaiting("ChatGPT says your image limit is used up for now. Try provider 'flow' or wait for the reset.");
      }
      const streaming = await page.locator('[data-testid="stop-button"], button[aria-label="Stop streaming"]').count();
      const found = await page.evaluate(() => {
        const imgs = [...document.querySelectorAll("main img")] as HTMLImageElement[];
        const gen = imgs.filter((i) => i.complete && i.naturalWidth >= 512 && /generated image/i.test(i.alt || ""));
        return gen.length ? gen[gen.length - 1].src : "";
      });
      return !streaming && found ? found : undefined;
    },
    6 * 60_000,
    3000,
    onTick,
  );

  // Give the final, sharp version a moment to replace the progressive preview.
  await sleep(3000);
  const finalSrc = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("main img")] as HTMLImageElement[];
    const gen = imgs.filter((i) => i.complete && i.naturalWidth >= 512 && /generated image/i.test(i.alt || ""));
    return gen.length ? gen[gen.length - 1].src : "";
  });

  const data = await fetchMedia(page, finalSrc || src, MEDIA_HOSTS);
  return { data, note: "chatgpt.com, normal chat (appears in your ChatGPT history)" };
}

/** If ChatGPT answered with text instead of an image (refusal, limit reached), surface that text. */
export async function chatgptLastReply(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const turns = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
      return (turns.at(-1) as HTMLElement | undefined)?.innerText?.slice(0, 500) ?? "";
    })
    .catch(() => "");
}
