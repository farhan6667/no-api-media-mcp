#!/usr/bin/env node
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup } from "./setup.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Browser } from "./browser.js";
import { loadConfig, readConfigFile, readState, STRIP_NOTICE, trustSystemCertificates, writeConfigFile, writeState } from "./config.js";
import { formatFromPath, optimizeImage, optimizeVideo, type ImageFormat } from "./optimize.js";
import { chatgptImage, chatgptLastReply, chatgptStatus } from "./providers/chatgpt.js";
import { codexImage, codexStatus } from "./providers/codex.js";
import { genericGenerate, genericStatus, loadSpecs } from "./providers/generic.js";
import { downloadHttps, higgsfieldCost, higgsfieldGenerate, higgsfieldLogin, higgsfieldStatus } from "./providers/higgsfield.js";
import { flowGenerate, flowQuote, flowStatus, geminiImage, type Aspect, type FlowModel } from "./providers/google.js";
import { imageSize, isInside, JobGate, log, MEDIA_EXTS, redact, resolveOutput, sniff } from "./safety.js";
import { ASSET_TYPES, AUDIT_RUBRIC, auditScores, designBrief, LOOKS, parseAspect, type Look } from "./design.js";
import { autoCleanup, cleanup, DEFAULT_DAYS, markDraft } from "./housekeeping.js";
import { classifyFailure, providerHealth, readReliability, recordProviderOutcome } from "./reliability.js";
import { autoInstall, checkForUpdate, updateNotice } from "./update.js";
import { learnedFor, learnedSentence, preferredStyleFor, readJournal, record } from "./learning.js";
import { lessonsFor } from "./lessons.js";
import { projectProfile, TIERS } from "./project.js";
import { DEFAULT_PRESETS, encodeAtSize, PLATFORMS, probe, removeBackground, SOCIAL_PRESETS, socialSizes, videoEdit, type Platform, type SocialPreset, type VideoOp } from "./edit.js";
import { calmWidth, composeHtml, cornerStats, logoHasTile, placeTextAndLogo, sampleGrey, textStyleFor, type Corner } from "./compose.js";
import { contactSheet, MAX_ITEMS as CONTACT_SHEET_MAX } from "./contact-sheet.js";
import { readManifest, usageReport } from "./report.js";
import { alive as pidAlive } from "./queue.js";
import { loopCheck } from "./loop-check.js";
import { cssVariables, dominantColors } from "./palette.js";
import { feedbackFor, forgetFeedback, readFeedback, recordFeedback } from "./feedback.js";
import { applyCrop, compositionCheck, FLAT_THUMBNAIL, type Edge } from "./composition.js";
import { getBrand, mergeBrand, readBrands, removeBrand, saveBrand } from "./brands.js";

// Single source of truth for the version: package.json (two levels up from dist/src).
const VERSION: string = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")).version;
trustSystemCertificates();
const cfg = loadConfig();
const browser = new Browser(cfg);

/** `status`/`setup` always show this synchronously so it's reliable even inside the rate-limit window; nothing here can throw past this function. */
async function printUpdateNoticeOnce() {
  try {
    const st = readState(cfg);
    const r = await checkForUpdate({ lastCheckedAt: st.updateLastCheckedAt, lastSeenVersion: st.updateLastSeenVersion }, { currentVersion: VERSION, intervalHours: cfg.checkUpdates ? cfg.updateCheckIntervalHours : Number.POSITIVE_INFINITY });
    if (cfg.checkUpdates) writeState(cfg, { ...(r.state.lastCheckedAt ? { updateLastCheckedAt: r.state.lastCheckedAt } : {}), ...(r.state.lastSeenVersion ? { updateLastSeenVersion: r.state.lastSeenVersion } : {}) });
    if (r.release) process.stdout.write(`${updateNotice(r.release, VERSION)}\n\n`);
  } catch {
    /* status must still print even if the check fails */
  }
}

if (process.argv[2] === "setup" || process.argv[2] === "status") {
  // `status` is setup without opening the sign-in window.
  await printUpdateNoticeOnce();
  const args = process.argv.slice(3);
  await runSetup(cfg, browser, VERSION, process.argv[2] === "status" ? [...args, "--no-login"] : args);
  process.exit(0);
}
if (process.argv[2] === "login") {
  const services = (process.argv[3] ?? "chatgpt,google").split(",");
  await runSetup(cfg, browser, VERSION, ["--services", services.join(",")]);
  process.exit(0);
}
if (process.argv[2] === "config") {
  const [, , , action, key, value] = process.argv;
  const KEYS = ["strip_ai_metadata", "auto_cleanup", "share_browser"];
  if (action === "set") {
    if (!KEYS.includes(key ?? "")) {
      process.stderr.write(`Unknown key "${key}". Keys: ${KEYS.join(", ")}\n`);
      process.exit(2);
    }
    const v = (value ?? "").toLowerCase();
    if (v !== "true" && v !== "false") {
      process.stderr.write(`Value must be true or false, got "${value}"\n`);
      process.exit(2);
    }
    writeConfigFile(cfg.home, { [key!]: v === "true" });
    process.stdout.write(`${key} = ${v}\n${key === "strip_ai_metadata" && v === "false" ? "media_optimize will now keep embedded metadata (EXIF/XMP/C2PA) where re-encoding can carry it.\n" : ""}`);
  } else {
    const env = process.env.NO_API_MEDIA_KEEP_METADATA ?? process.env.NOAPI_KEEP_METADATA;
    const file = readConfigFile(cfg.home);
    const source = env !== undefined ? `environment (NO_API_MEDIA_KEEP_METADATA=${env})` : file.strip_ai_metadata !== undefined ? "config.json" : "default";
    process.stdout.write(`strip_ai_metadata = ${cfg.stripAiMetadata}   (from ${source})\nauto_cleanup = ${cfg.autoCleanup}   (old rejected and used drafts in .ai-media are removed after a grace period; NOAPI_AUTO_CLEANUP=0 turns it off)\nshare_browser = ${cfg.shareBrowser}   (true: several sessions use the signed-in browser as separate tabs at once, through a loopback-only devtools port; false: a second session waits in a queue)\nconfig file: ${join(cfg.home, "config.json")}\n`);
  }
  process.exit(0);
}
if (process.argv[2] === "help" || process.argv[2] === "--help") {
  process.stdout.write(
    `no-api-media-mcp ${VERSION}\n\n` +
      "  npx no-api-media-mcp setup            check everything, open the sign-in window, print client config\n" +
      "  npx no-api-media-mcp login [services] sign in again: login google, login chatgpt, or login chatgpt,google\n" +
      "  npx no-api-media-mcp status           show which accounts are ready, without opening a window\n" +
      "  npx no-api-media-mcp config           show settings (strip_ai_metadata and where it comes from)\n" +
      "  npx no-api-media-mcp config set strip_ai_metadata false   keep embedded metadata in optimized files\n" +
      "  npx no-api-media-mcp --version\n\n" +
      "Without a command it runs as an MCP server over stdio (that's what your AI client starts).\n",
  );
  process.exit(0);
}
if (process.argv[2] === "--version" || process.argv[2] === "-v") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
/** Shown once after upgrading to 0.3.0: in the first media_optimize result, and by `setup`/`status`. */
function firstTimeNotice(): string | undefined {
  if (readState(cfg).stripNoticeShown) return undefined;
  writeState(cfg, { stripNoticeShown: "1" });
  return STRIP_NOTICE;
}
if (!readState(cfg).stripNoticeShown) log("NOTICE:", STRIP_NOTICE);

/** Runs once at startup, never blocks it. Logs a notice to stderr only; never touches a tool result. */
function backgroundUpdateCheck() {
  if (!cfg.checkUpdates) return;
  const state = readState(cfg);
  checkForUpdate({ lastCheckedAt: state.updateLastCheckedAt, lastSeenVersion: state.updateLastSeenVersion }, { currentVersion: VERSION, intervalHours: cfg.updateCheckIntervalHours })
    .then(async (r) => {
      writeState(cfg, { ...(r.state.lastCheckedAt ? { updateLastCheckedAt: r.state.lastCheckedAt } : {}), ...(r.state.lastSeenVersion ? { updateLastSeenVersion: r.state.lastSeenVersion } : {}) });
      if (!r.release) return;
      log("NOTICE:", updateNotice(r.release, VERSION));
      if (cfg.autoUpdate) {
        const res = await autoInstall(r.release.version);
        log(res.ok ? `Updated to v${r.release.version}. It will be used the next time this server starts.` : `Auto-update failed: ${res.detail}`);
      }
    })
    .catch(() => {
      /* never breaks the server */
    });
}
backgroundUpdateCheck();

const gate = new JobGate(cfg.minGapSeconds * 1000);
// Local edits (ffmpeg, rembg) touch no website, so they skip the human-pace gap but still run one at a time.
const localGate = new JobGate(0);
/**
 * Sent to every MCP client when it connects, so the user can say "make a hero image for this site"
 * and the agent already knows the whole workflow. No prompt engineering on the user's side.
 */
const INSTRUCTIONS = `no-api-media makes images and videos with the user's own AI subscriptions. Never ask the user for an API key.

Recognise what kind of project this is yourself, before asking, and go straight to the matching asset types and tools:
- A GitHub repo (package.json, a .git folder, a README): hero/banner for the README, a logo, a github-social-1280x640 preview and a favicon. social_sizes covers all the standard sizes in one call.
- A single social post or launch announcement (LinkedIn, X, Instagram, no project files involved): asset_type "social-post" or "poster", then social_sizes with the one platform preset that matches (linkedin-portrait-1080x1350 or linkedin-square-1080 for a feed post, x-1600x900, instagram-square-1080, and so on; linkedin-link-1200x627 is only for link previews).
- A website or portfolio that mentions three.js, react-three-fiber, @react-three, babylon, spline or WebGL (check package.json and the code, project_profile already reads these files): reach for asset_type "environment-map" for reflections and ambient lighting and "texture" for tileable materials or backgrounds, on top of the usual hero and background-video. Run loop_check on any looping clip before it ships; run contact_sheet when there are several candidate environment maps or textures to compare.
- An animated landing page or portfolio (motion, framer-motion, gsap, lottie in package.json, or the user says "animated"): asset_type "background-video" or "product-video", built with the motion timing already baked into those playbooks, then loop_check before calling it done.
Any of these can combine (a GitHub repo for a three.js site needs both the repo treatment and the 3D-specific assets). When none of this matches, fall back to asking what the asset is for.

When the user asks for any image or video for their project, do this without asking them to write prompts:
1. Call project_profile. Open the reference images it lists to see the current look.
2. Before generating anything, make sure you know two things: where it will be used (which platform and which spot, so the size and aspect are right instead of guessed) and what it goes with (the post, page or story, so the image carries the same message). If the conversation or the project already answers both, go ahead. If not, ask the user one short question covering both, then continue: one question costs seconds, a wrong guess costs a whole round. When design_brief returns needs_from_user, those are the questions to ask.
   Then decide the slots: where the asset goes (hero, OG image, feature icons, background video...), size, file path in the project's asset folder. Put the answers in context.usage, context.goal and context.targetAspect.
3. Call design_brief like a creative director briefing a designer: asset type, subject, brand colours, style tier, and a full "context" (project name, what it does from project_profile.about, WHO sees it in context.audience, where it goes, what it must achieve, and exactText for any words). Quality defaults to premium. If the user named a level ("premium", "glowing", "minimal", "luxury 3D"), that wins.
   Say who actually looks at this in context.audience (a CISO, developers, the open source community, security analysts, the general public). design_brief recognises a few real audiences and changes tone, default tier and palette for them, and the brief tells you which one it matched. Don't invent an audience it doesn't have: a wrong or made-up one is worse than leaving it unset.
4. Generate the brief's directions with image_generate. Designs with words (infographic, poster, logo with wordmark) go to "codex" first (GPT Image renders text best), then "flow". Photo and 3D scenes go to "flow" (Nano Banana 2, 0 credits on AI Pro). Save drafts into .ai-media (no output_path).
5. Look at every result yourself and score it against the brief's critique list, then run the eye-catch audit: score each criterion 0 to 5 and call design_audit. Rewrite the prompt for the exact failures it names and retry, at most 3 rounds. Ship only on "ship".
   Words and numbers that must be exact (a terminal command, a results table, a diagram with labels) are better drawn locally as SVG or HTML and rendered than asked from an image model. Use the image model for the art around them.
   Never generate the user's own logo or a third party's logo. Place the real logo file from the project after generation. A named third-party product (for example a security platform) is shown through colour and motif only, with an "independent project" note on public assets.
6. Show the user a shortlist with one line of reasoning each before placing anything, unless they told you to just do it.
   Pass asset_type and the draft's file to design_audit, so the server learns what keeps going wrong and a rejected draft can be cleaned up later. design_brief already carries "learned" advice from earlier audits and built-in lessons: follow them on the first try.
   Always set context.targetAspect to the shape the image will finally be cropped to (a profile banner is about 3.2:1).
   Compose real logos and text over generated art yourself: a black-background logo goes on a dark glass plate or a feathered mask, never plain screen blending.
   design_brief also suggests a brand palette and a heading/body Google Fonts pairing when you didn't supply your own (curated, not invented). Load that font pairing's Google Fonts URL in the HTML you render for the wordmark and any composited text, instead of a generic system font: a real display font is most of what separates a premium banner from a plain one.
7. media_optimize the winner into the real asset folder (the project's own images folder, never leave a final in .ai-media), wire it into the code with width, height and real alt text, then check the page. design_brief's alt_text_suggestion is a starting template, not a finished description: replace it with what the image actually shows once you've looked at it. Drafts in .ai-media are cleaned up on their own: rejected ones after a few days, used ones after a couple of weeks (media_cleanup shows or does it on demand).
   media_optimize strips embedded metadata (EXIF, XMP, C2PA content credentials) from its output by default and reports what it removed; if the user wants provenance kept, pass keep_metadata: true. It never touches invisible watermarks.
8. Comparing several directions or iterations before picking one? Call contact_sheet to lay them on one grid instead of opening each file alone. Curious what's actually been generated in a project over time? usage_report totals the local manifest by provider, type and day, no uploads.
   Want the site's CSS variables to actually match a generated hero or banner instead of guessing? Run palette_extract on the chosen file and wire its colours into the stylesheet; it names them by how dominant they are, not by a guessed role, so pick which one is the primary or the accent yourself.
   For a texture or environment-map, verify the tile or the seam for real before using it: contact_sheet with four copies of a texture shows a repeat at a glance, and the 2:1 wrap on an environment-map should be checked by eye at the left-right edge.
When the user criticises a result (a colour, a crop, an empty band, how the text looks, the wrong logo), call design_feedback straight away with what was wrong and what they want instead, so it's never repeated. design_brief brings these back: follow its user_feedback in the prompt and its compositing_rules when you set text and logos.
Set text and logos with compose (pass brand_id from brand_profiles, so the right mark goes on: a person's own posts get their personal mark, company posts the company mark) rather than writing your own HTML, then finish with deliver for the platform (linkedin-feed, x-post, github-social and so on) instead of hand-tuning size and quality.
Run composition_check on drafts and on the final file: an empty band at an edge gets cropped, or the headline goes into it on purpose. Pass context.overlayText to design_brief only when you will really set words on top; otherwise it asks the model for a full frame.
Several sessions at once: with share_browser on (the default) each session gets its own tab in the same signed-in browser and jobs run side by side. If sharing is off, or the other browser can't be joined, a job waits in a queue and says so in its progress messages (its place in line, and an estimate once there's history), then carries on by itself, so tell the user it's queued rather than retrying.
For videos: always call video_quote first, tell the user the credit cost, and pass max_credits. Never solve captchas; if a site asks for a human check or a sign-in, tell the user to run accounts_login.`;

const server = new McpServer({ name: "no-api-media-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
const specs = loadSpecs(cfg.home);
if (specs.errors.length) log("ignored provider specs:", specs.errors.join("; "));

const ASPECTS = ["16:9", "4:3", "1:1", "3:4", "4:5", "9:16"] as const;
const FLOW_VIDEO = ["veo-lite", "veo-fast", "veo-quality", "omni-flash"];
const CLI_PROVIDERS = ["codex", "higgsfield"];
const BROWSER_BUILTINS = ["chatgpt", "flow", "gemini"];

function loginUrls(): Record<string, string> {
  const m: Record<string, string> = { chatgpt: "https://chatgpt.com/", google: "https://flow.google.com/" };
  for (const s of specs.specs) m[s.id] = s.url;
  return m;
}

function knownProvider(id: string): boolean {
  return CLI_PROVIDERS.includes(id) || BROWSER_BUILTINS.includes(id) || specs.specs.some((s) => s.id === id);
}

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: redact(JSON.stringify(data, null, 2)) }] };
}
function fail(e: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: redact((e as Error).message ?? String(e)) }] };
}

interface Extra {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (n: { method: "notifications/progress"; params: { progressToken: string | number; progress: number; total?: number; message?: string } }) => Promise<void>;
}

/**
 * Long jobs (videos take minutes) report progress so MCP clients don't time out, and a heartbeat keeps
 * going even while a CLI is busy. Returns an onTick callback for the polling loops and a stop function.
 */
function progress(extra: Extra, label: string) {
  const token = extra._meta?.progressToken;
  const start = Date.now();
  let n = 0;
  const send = (message: string) => {
    if (token === undefined) return;
    void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++n, message } }).catch(() => undefined);
  };
  send(`${label}: started`);
  const beat = setInterval(() => send(`${label}: working, ${Math.round((Date.now() - start) / 1000)}s`), 15_000);
  beat.unref();
  return {
    onTick: (_ms: number) => undefined,
    /** A free-text status line, e.g. for a browser join/queue wait while another session has it open. */
    status: send,
    done: () => clearInterval(beat),
  };
}

/** Run a generation job: one at a time, with progress, cancellation and the heartbeat cleaned up. */
function job<T>(extra: Extra, key: string, label: string, fn: (onTick: (ms: number) => void, status: (msg: string) => void) => Promise<T>, g: JobGate = gate) {
  const p = progress(extra, label);
  return g
    .run(key, async () => {
      if (extra.signal.aborted) throw new Error("Cancelled");
      return fn(p.onTick, p.status);
    })
    .finally(p.done);
}

/**
 * Flow finds a new result by comparing the project's tiles before and after, so two sessions generating
 * in the same Flow project at once could pick up each other's image. One session at a time owns the saved
 * project (a small pid lock); any other session works in a project of its own, kept for its lifetime.
 */
let sessionFlowProject: string | undefined;
const flowLock = () => join(cfg.home, "flow-project.lock");
function claimFlowProject(): string | undefined {
  if (sessionFlowProject) return sessionFlowProject;
  try {
    const owner = Number(readFileSync(flowLock(), "utf8"));
    if (owner && owner !== process.pid && pidAlive(owner)) return undefined;
  } catch {
    /* no lock yet */
  }
  mkdirSync(cfg.home, { recursive: true });
  writeFileSync(flowLock(), String(process.pid));
  return readState(cfg).flowProject;
}
function keepFlowProject(url: string) {
  let owner = 0;
  try {
    owner = Number(readFileSync(flowLock(), "utf8"));
  } catch {
    /* no lock */
  }
  if (owner === process.pid) writeState(cfg, { flowProject: url });
  else sessionFlowProject = url;
}

/** Keep raw outputs out of git: .ai-media ignores itself. */
function ensureMediaDir(root: string) {
  const dir = join(root, ".ai-media");
  mkdirSync(dir, { recursive: true });
  const gi = join(dir, ".gitignore");
  if (!existsSync(gi)) writeFileSync(gi, "*\n");
  return dir;
}

/** Reject a bad output_path before any quota or credits are spent. */
function precheck(outputPath: string | undefined, overwrite: boolean) {
  if (!outputPath) return;
  resolveOutput({ roots: cfg.outputRoots, outputPath, provider: "check", prompt: "", ext: extname(outputPath), overwrite, dryRun: true });
}

function numbered(outputPath: string | undefined, i: number) {
  return outputPath && i > 0 ? outputPath.replace(/(\.\w+)$/, `-${i + 1}$1`) : outputPath;
}

function save(buf: Buffer, provider: string, prompt: string, outputPath: string | undefined, overwrite = false) {
  const kind = sniff(buf);
  if (!kind) throw new Error("The provider returned something that is not an image or video. Nothing was saved.");
  let wanted = outputPath;
  if (wanted && extname(wanted).toLowerCase() !== kind.ext && !(kind.ext === ".jpg" && /\.jpe?g$/i.test(wanted))) {
    wanted = wanted.slice(0, wanted.length - extname(wanted).length) + kind.ext;
  }
  const root = realpathSync(cfg.outputRoots[0]);
  const mediaDir = ensureMediaDir(root);
  const file = resolveOutput({ roots: cfg.outputRoots, outputPath: wanted, provider, prompt, ext: kind.ext, overwrite });
  writeFileSync(file, buf, { flag: overwrite ? "w" : "wx" });
  const size = kind.mime.startsWith("image/") ? imageSize(buf) : undefined;
  // Paths are returned relative to the project, so the user's home folder name never leaves the machine.
  const entry = { time: new Date().toISOString(), provider, file: relative(root, file), bytes: buf.length, mime: kind.mime, ...size, prompt };
  appendFileSync(join(mediaDir, "manifest.jsonl"), JSON.stringify(entry) + "\n");
  // Housekeeping runs before the new file is registered, so it can never touch it.
  const hk = autoCleanup(root, cfg.autoCleanup);
  markDraft(root, file, { status: "draft" });
  return hk
    ? { ...entry, housekeeping: { removed: hk.removed.length, freedMB: Math.round(hk.freedBytes / 10_485.76) / 100, note: "Old rejected or used drafts in .ai-media were removed. Final files in the project are never touched." } }
    : entry;
}

server.registerTool(
  "accounts_login",
  {
    title: "Sign in to your AI accounts",
    description:
      "Opens a normal Chrome window on the private no-api-media profile so the USER can sign in by hand. " +
      "The server never sees or stores a password. Tell the user to sign in, then close that window.",
    inputSchema: {
      services: z
        .array(z.string().max(40))
        .default(["chatgpt", "google"])
        .describe(`Any of: ${[...Object.keys(loginUrls()), "higgsfield"].join(", ")}`),
    },
  },
  async ({ services }) => {
    try {
      const map = loginUrls();
      const unknown = services.filter((s) => !map[s] && s !== "higgsfield");
      if (unknown.length) throw new Error(`Unknown service: ${unknown.join(", ")}. Known: ${Object.keys(map).join(", ")}, higgsfield`);
      if (services.includes("higgsfield")) higgsfieldLogin();
      const urls = services.filter((s) => s !== "higgsfield").map((s) => map[s]);
      if (urls.length) await browser.openForLogin(urls);
      return ok({
        opened: services,
        higgsfield: services.includes("higgsfield") ? "Higgsfield's own CLI opened its sign-in page in your default browser. Sign in there." : undefined,
        next: urls.length
          ? "Sign in yourself in the Chrome window that just opened. For Google, use the account that has your AI plan. Close the window when done, then call accounts_status."
          : "Then call accounts_status.",
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "providers_list",
  {
    title: "List the AI sites this server can drive",
    description: "Built-in providers plus JSON specs from ~/.no-api-media/providers. Shows what each can make.",
    inputSchema: {},
  },
  async () =>
    ok({
      builtIn: [
        { id: "codex", kinds: ["image"], via: "Codex CLI signed in with ChatGPT (most reliable ChatGPT route)" },
        { id: "chatgpt", kinds: ["image"], via: "chatgpt.com in the private browser profile", login: "chatgpt" },
        { id: "flow", kinds: ["image", "video"], via: "Google Flow (Nano Banana, Veo, Omni)", login: "google" },
        { id: "gemini", kinds: ["image"], via: "gemini.google.com", login: "google" },
        { id: "higgsfield", kinds: ["image", "video"], via: "official Higgsfield CLI (OAuth sign-in, your plan's credits). Pass model, e.g. nano_banana_2, seedance_2_0, kling3_0", login: "higgsfield" },
      ],
      specs: specs.specs.map((s) => ({ id: s.id, name: s.name, kinds: s.kinds, url: s.url, notes: s.notes, login: s.id })),
      addYourOwn: "~/.no-api-media/providers/<id>.json",
      specErrors: specs.errors,
    }),
);

const brandShape = {
  name: z.string().max(80).optional(),
  publisher: z.enum(["person", "company"]).optional().describe("Who publishes it: a person posting as themselves (their own mark) or a company (the company mark)"),
  logo: z.object({ dark: z.string().max(400).optional(), light: z.string().max(400).optional() }).optional().describe("Real logo files for dark and light backgrounds; composited afterwards, never generated"),
  colors: z.array(z.string().max(30)).max(6).optional().describe("Hex codes from the project, e.g. #0f6b3a"),
  mood: z.string().max(120).optional(),
  audience: z.string().max(120).optional(),
  avoid: z.array(z.string().max(60)).max(12).optional(),
};

server.registerTool(
  "design_brief",
  {
    title: "Art direction before generating",
    description:
      "Call this BEFORE image_generate or video_generate. Returns designer-grade guidance for the asset type: what good looks like, " +
      "concept directions with ready prompts written like a real creative brief, a critique checklist to judge every result, and the iteration process. " +
      "Fill `context` from project_profile and the conversation: what the project is, where the asset goes and why. That story is what makes results " +
      "premium instead of generic. Quality defaults to premium. For designs with words (infographic, poster, social post) put every word in context.exactText.",
    inputSchema: {
      asset_type: z.enum(ASSET_TYPES),
      subject: z.string().min(3).max(600).describe("What it should show or express, e.g. 'image and video generation without API keys'"),
      brand: z.object(brandShape).default({}),
      brand_id: z.string().max(40).optional().describe("A brand registered with brand_profiles (e.g. sfa, nexaforge): fills in publisher, logo files, palette and fonts"),
      style: z
        .object({
          tier: z.enum(TIERS).optional().describe("From project_profile, or what the user asked for"),
          look: z.enum(Object.keys(LOOKS) as [Look, ...Look[]]).optional().describe("Named visual family. neon-glass = dark navy, glowing cyan/blue/violet glass, the style of this project's own graphics"),
          motion: z.enum(["3d", "animated", "static"]).optional(),
          theme: z.enum(["dark", "light", "unknown"]).optional(),
          referenceNotes: z.string().max(400).optional().describe("A few words on the project's existing images you looked at"),
        })
        .default({}),
      context: z
        .object({
          project: z.string().max(80).optional(),
          about: z.string().max(600).optional().describe("What the project does, in plain words (project_profile.about)"),
          audience: z.string().max(200).optional(),
          usage: z.string().max(200).optional().describe("Where it goes, e.g. 'the README header on GitHub'"),
          goal: z.string().max(300).optional().describe("What it must achieve, e.g. 'make developers get the idea in 5 seconds'"),
          exactText: z.array(z.string().max(120)).max(20).optional().describe("Every word that must appear, spelled exactly"),
          targetAspect: z.string().max(20).optional().describe('The shape the image is finally cropped to, e.g. "3.2:1" for a profile banner. Very wide crops get composition guidance'),
          overlayText: z.array(z.string().max(120)).max(6).optional().describe("Words you'll set over the art yourself afterwards (a headline). The brief leaves room only for these; leave it out and it asks for a full frame with no empty band"),
        })
        .default({}),
    },
  },
  async (a) => {
    const profile = a.brand_id ? getBrand(cfg.home, a.brand_id) : undefined;
    if (a.brand_id && !profile) return fail(new Error(`No brand "${a.brand_id}". Registered: ${readBrands(cfg.home).map((b) => b.id).join(", ") || "none yet"} (brand_profiles).`));
    const brand = mergeBrand(profile, a.brand);
    const journal = readJournal(cfg.home);
    const items = learnedFor(journal, a.asset_type);
    return ok(
      designBrief(a.asset_type, a.subject, brand, a.style, a.context, {
        fonts: profile?.fonts,
        learned: learnedSentence(items),
        learnedItems: items,
        lessons: lessonsFor(a.asset_type),
        reviewNotes: lessonsFor(a.asset_type, 4, "review"),
        preferredStyle: preferredStyleFor(journal, a.asset_type),
        userFeedback: feedbackFor(readFeedback(cfg.home), a.asset_type, brand.name),
      }),
    );
  },
);

server.registerTool(
  "design_audit",
  {
    title: "Eye-catch audit of a finished image",
    description:
      "After you have LOOKED at a generated image, score it 0 to 5 on each criterion (focal-point, thumbnail, hierarchy, palette, topic-cues, brand-presence, text-accuracy, not-template) " +
      "and pass the scores here. Returns ship or revise, the weakest points and the exact fix for each. Call with no scores to get the criteria. " +
      "Be harsh: a generic, flat or template-looking result scores 2 or 3. " +
      "Pass asset_type so the server learns what usually goes wrong and warns you up front next time. " +
      "Pass file (the draft inside .ai-media) so a revise marks it rejected, which lets it be cleaned up later, and a ship marks it shortlisted. " +
      "Pass style.tier and style.look (whatever you actually passed to design_brief) so the server can remember, once enough drafts have shipped, which tier and look tend to work for this asset type and suggest it by default next time.",
    inputSchema: {
      scores: z.record(z.string().max(30), z.number().min(0).max(5)).default({}),
      asset_type: z.enum(ASSET_TYPES).optional(),
      file: z.string().max(500).optional().describe("The draft you scored, relative to the project, e.g. .ai-media/codex/banner.png. It's also measured, and the measurements can cap your scores"),
      planned_edges: z.array(z.enum(["top", "bottom", "left", "right"])).max(4).optional().describe("Edges left calm on purpose for text, so they don't count as empty bands"),
      style: z
        .object({ tier: z.enum(TIERS).optional(), look: z.enum(Object.keys(LOOKS) as [Look, ...Look[]]).optional() })
        .optional()
        .describe("The style you actually used for this draft, so a shipped result can be remembered"),
    },
  },
  async (a) => {
    try {
      if (!Object.keys(a.scores).length) return ok({ criteria: AUDIT_RUBRIC.map((r) => ({ id: r.id, ask: r.ask })), pass: "average 4 or more, nothing below 3" });
      // Measured checks back the self-scores: the model can't pass its own result past an empty band or a
      // thumbnail that reads as one flat tone.
      const scores = { ...a.scores };
      const capped: string[] = [];
      let measured: Record<string, unknown> | undefined;
      if (a.file) {
        const { file: abs } = resolveInput(a.file);
        if (sniff(readHead(abs))?.mime.startsWith("image/")) {
          const c = await compositionCheck(abs, { plannedEdges: a.planned_edges as Edge[] | undefined });
          measured = { composition: c.verdict, bands: c.bands, thumbnailSpread: c.thumbnailSpread };
          const cap = (id: string, max: number, why: string) => {
            if ((scores[id] ?? 0) > max) {
              scores[id] = max;
              capped.push(`${id} capped at ${max}: ${why}`);
            }
          };
          if (c.verdict === "empty-band") cap("hierarchy", 2, "an empty band at an edge (composition_check)");
          if (c.thumbnailSpread < FLAT_THUMBNAIL) cap("thumbnail", 2, `the thumbnail is nearly one flat tone (spread ${c.thumbnailSpread})`);
        }
      }
      const result = auditScores(scores);
      // A measured failure gets the measured fix, not the generic one for that criterion.
      const measuredFix: Record<string, string> = {
        hierarchy: "Crop the empty band away (composition_check gives the crop, with target_aspect to keep the shape), or set the headline into it on purpose.",
        thumbnail: "Raise contrast between the subject and the background, and enlarge the subject, so it still reads at 120 px wide.",
      };
      for (const fx of result.fixes) if (capped.some((c) => c.startsWith(fx.id + " ")) && measuredFix[fx.id]) fx.fix = measuredFix[fx.id]!;
      if (a.asset_type) record(cfg.home, { asset: a.asset_type, scores, average: result.average, verdict: result.verdict, tier: a.style?.tier, look: a.style?.look });
      let marked: string | undefined;
      if (a.file) {
        const root = realpathSync(cfg.outputRoots[0]);
        const abs = realpathSync(resolve(root, a.file));
        if (isInside(abs, join(root, ".ai-media")) && markDraft(root, abs, { status: result.verdict === "ship" ? "shortlisted" : "rejected", note: `audit average ${result.average}` })) {
          marked = result.verdict === "ship" ? "shortlisted" : "rejected";
        }
      }
      return ok({ ...result, ...(measured ? { measured } : {}), ...(capped.length ? { capped } : {}), ...(marked ? { draft: marked } : {}) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "brand_profiles",
  {
    title: "Register the brands you publish under",
    description:
      "Keeps a profile per brand so the right logo is never guessed: who publishes (a person posting as themselves, or a company), the real logo files for dark and light backgrounds, " +
      "and optionally palette and fonts. design_brief takes brand_id and fills these in; compose places that brand's logo. action list, set or remove. Stored on this machine only.",
    inputSchema: {
      action: z.enum(["list", "set", "remove"]).default("list"),
      id: z.string().max(40).optional().describe("Short id, e.g. sfa or nexaforge"),
      name: z.string().max(80).optional(),
      publisher: z.enum(["person", "company"]).optional(),
      logo_dark: z.string().max(400).optional().describe("Absolute path of the logo made for dark backgrounds"),
      logo_light: z.string().max(400).optional().describe("Absolute path of the logo made for light backgrounds"),
      colors: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(6).optional(),
      heading_font: z.string().max(60).optional(),
      body_font: z.string().max(60).optional(),
      google_fonts_url: z.string().url().max(400).optional(),
      used_for: z.string().max(200).optional().describe("When to use it, e.g. 'his own LinkedIn posts and portfolio'"),
    },
  },
  async (a) => {
    try {
      if (a.action === "list") return ok({ brands: readBrands(cfg.home) });
      if (!a.id) throw new Error(`${a.action} needs an id.`);
      if (a.action === "remove") return ok({ removed: removeBrand(cfg.home, a.id) });
      if (!a.name || !a.publisher) throw new Error("set needs at least name and publisher.");
      const saved = saveBrand(cfg.home, {
        id: a.id,
        name: a.name,
        publisher: a.publisher,
        ...(a.logo_dark || a.logo_light ? { logo: { ...(a.logo_dark ? { dark: resolve(a.logo_dark) } : {}), ...(a.logo_light ? { light: resolve(a.logo_light) } : {}) } } : {}),
        ...(a.colors?.length ? { colors: a.colors } : {}),
        ...(a.heading_font && a.body_font ? { fonts: { heading: a.heading_font, body: a.body_font, ...(a.google_fonts_url ? { googleFontsUrl: a.google_fonts_url } : {}) } } : {}),
        ...(a.used_for ? { usedFor: a.used_for } : {}),
      });
      return ok({ saved });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "design_feedback",
  {
    title: "Remember a correction the user gave",
    description:
      "When the user says something about a result was wrong (a colour, a crop, an empty band, how the text looks, the wrong logo), call this right away with what was wrong and what they want instead. " +
      "It's kept in a local journal on this machine, and every later design_brief applies it: image corrections go into the prompt as what to do, corrections about text and logos come back as compositing_rules. " +
      "Set brand when the correction is about one brand (\"use the SFA mark on his personal posts\"), so it never leaks into another brand's work. " +
      "action list shows what's stored, action forget removes one entry by its time. Pass file to mark that draft rejected.",
    inputSchema: {
      action: z.enum(["add", "list", "forget"]).default("add"),
      asset_type: z.union([z.enum(ASSET_TYPES), z.literal("all")]).default("all"),
      problem: z.string().max(300).optional().describe("What was wrong, in the user's terms, e.g. 'an empty navy band across the top'"),
      instead: z.string().max(300).optional().describe("What they want instead, e.g. 'fill the frame and crop to the content'"),
      brand: z.string().max(60).optional().describe("Only apply this to one brand's work, matched against brand.name in design_brief"),
      applies_to: z.enum(["image", "compositing", "both"]).optional().describe("Leave out to let the server decide: anything about text, fonts or logos is compositing"),
      time: z.string().max(40).optional().describe("forget: the time stamp of the entry, from list"),
      file: z.string().max(500).optional().describe("add: the draft it was about, relative to the project"),
    },
  },
  async (a) => {
    try {
      if (a.action === "list") return ok({ entries: readFeedback(cfg.home) });
      if (a.action === "forget") {
        if (!a.time) throw new Error("forget needs the entry's time, from action list.");
        return ok({ removed: forgetFeedback(cfg.home, a.time) });
      }
      if (!a.problem?.trim() || !a.instead?.trim()) throw new Error("add needs both problem and instead.");
      // Check the file before writing anything, so a bad path can't leave a half-recorded correction.
      let abs: string | undefined;
      let root: string | undefined;
      if (a.file) {
        root = realpathSync(cfg.outputRoots[0]);
        abs = realpathSync(resolve(root, a.file));
        if (!isInside(abs, join(root, ".ai-media"))) throw new Error("file must be a draft inside .ai-media.");
      }
      const e = recordFeedback(cfg.home, { asset: a.asset_type, problem: a.problem, instead: a.instead, scope: a.applies_to, brand: a.brand });
      if (!e) throw new Error("Both problem and instead need some real text.");
      const marked = abs && root ? markDraft(root, abs, { status: "rejected", note: `user: ${e.problem}` }) : false;
      return ok({ recorded: e, ...(marked ? { draft: "rejected" } : {}), applies_from_now: feedbackFor(readFeedback(cfg.home), a.asset_type, a.brand) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "composition_check",
  {
    title: "Find empty bands at the edges",
    description:
      "Measures an image for the empty band generated art often leaves at an edge (a plain sky or flat strip meant for text that never came) and returns how much of the frame it takes, " +
      "plus a crop that removes it. Pass output_path to save the cropped version. Run it on a draft before compositing and on the final file before shipping.",
    inputSchema: {
      input_path: z.string().max(500),
      output_path: z.string().max(500).optional().describe("If set and a band is found, the cropped image is saved here"),
      target_aspect: z.string().max(20).optional().describe('Keep this shape when cropping, e.g. "4:5" for a LinkedIn feed post'),
      planned_edges: z.array(z.enum(["top", "bottom", "left", "right"])).max(4).optional().describe("Edges you left calm on purpose for text you'll set there"),
      overwrite: z.boolean().default(false),
    },
  },
  async (a) => {
    try {
      const { root, file } = resolveInput(a.input_path);
      if (!sniff(readHead(file))?.mime.startsWith("image/")) throw new Error("composition_check works on images.");
      const r = await compositionCheck(file, { aspect: parseAspect(a.target_aspect), plannedEdges: a.planned_edges as Edge[] | undefined });
      let saved: string | undefined;
      if (a.output_path && r.suggestedCrop) {
        const out = resolveOutput({ roots: cfg.outputRoots, outputPath: a.output_path, provider: "composition", prompt: "", ext: extname(a.output_path) || ".png", overwrite: a.overwrite });
        await applyCrop(file, out, r.suggestedCrop);
        saved = relative(root, out);
      }
      return ok({ ...r, ...(saved ? { saved } : {}) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "media_cleanup",
  {
    title: "Clean up old drafts",
    description:
      "Removes old drafts from <project>/.ai-media to stop it growing: rejected drafts after a few days, drafts already used for a final file after a couple of weeks, and untouched drafts after a month. " +
      "Only files inside .ai-media are ever considered, final assets in the project are never touched, and a used draft goes only if its final file still exists. " +
      "dry_run is true by default: it lists what would be removed and how much space it frees. Pass dry_run: false to delete. The server also does this on its own once per session unless auto_cleanup is off.",
    inputSchema: {
      dry_run: z.boolean().default(true),
      rejected_days: z.number().int().min(0).max(365).optional().describe(`Default ${DEFAULT_DAYS.rejected}`),
      used_days: z.number().int().min(0).max(365).optional().describe(`Default ${DEFAULT_DAYS.used}`),
      draft_days: z.number().int().min(1).max(365).optional().describe(`Default ${DEFAULT_DAYS.draft}`),
    },
  },
  async (a) => {
    try {
      const root = realpathSync(cfg.outputRoots[0]);
      const r = cleanup(root, { dryRun: a.dry_run, days: { rejected: a.rejected_days, used: a.used_days, draft: a.draft_days } as Partial<typeof DEFAULT_DAYS> });
      return ok({ dryRun: r.dryRun, wouldFreeMB: Math.round(r.freedBytes / 10_485.76) / 100, removed: r.removed, keptFiles: r.kept });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "project_profile",
  {
    title: "Work out the project's visual personality",
    description:
      "Read-only scan of the project: 3D or animation libraries, luxury/premium/playful/corporate/modest wording, brand colours, fonts, " +
      "dark or light theme, and the existing images to use as references. Call it first, open the reference images yourself, " +
      "then pass the result to design_brief. If the user states the level they want (e.g. 'premium', 'glowing', 'minimal'), that wins.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(projectProfile(realpathSync(cfg.outputRoots[0])));
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerPrompt(
  "design-asset",
  {
    title: "Design a project asset properly",
    description: "Brief, explore three directions, critique hard, iterate, then place the winner. Works for logos, heroes, icons, banners and videos.",
    argsSchema: {
      asset_type: z.string().describe(ASSET_TYPES.join(", ")),
      subject: z.string(),
    },
  },
  ({ asset_type, subject }) => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text:
            `Act as a senior brand designer. Make a ${asset_type} for: ${subject}.\n` +
            `1. Read this project's colours, fonts, existing images and tone.\n` +
            `2. Call design_brief with asset_type "${asset_type}", the subject, and the brand you found.\n` +
            `3. Generate every direction it returns (into .ai-media, several variants each when possible).\n` +
            `4. Open and look at every result. Score each against the brief's critique list and write the failures down. Be harsh: generic or clip-art results fail.\n` +
            `5. Fix the prompt for the specific failures and regenerate. At most 3 rounds.\n` +
            `6. Show me a shortlist of 2 or 3 with your reasoning before placing anything. For a logo, rebuild the winner as a clean SVG.\n` +
            `7. Only after I pick: media_optimize and wire it into the project.`,
        },
      },
    ],
  }),
);

server.registerTool(
  "accounts_status",
  {
    title: "Check which accounts are ready",
    description: "Checks Codex and Higgsfield CLI sign-in, ChatGPT web sign-in, the Google account and plan tier on Flow, and every JSON-defined site.",
    inputSchema: {},
  },
  async (_a, extra) => {
    const out: Record<string, unknown> = { version: VERSION, codex: await codexStatus(), higgsfield: await higgsfieldStatus() };
    try {
      const page = await browser.page(extra.signal);
      try {
        try {
          out.chatgpt = await chatgptStatus(page);
        } catch (e) {
          out.chatgpt = { signedIn: false, detail: (e as Error).message };
        }
        try {
          out.google = await flowStatus(page, cfg.googleEmail);
        } catch (e) {
          out.google = { signedIn: false, detail: (e as Error).message };
        }
        for (const s of specs.specs) {
          try {
            out[s.id] = await genericStatus(page, s);
          } catch (e) {
            out[s.id] = { signedIn: false, detail: (e as Error).message };
          }
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    } catch (e) {
      out.browser = (e as Error).message;
    }
    out.outputRoots = cfg.outputRoots;
    return ok(out);
  },
);

server.registerTool(
  "image_generate",
  {
    title: "Generate an image with your own account",
    description:
      "Generates one image (Flow and Higgsfield can return several) and saves the full-quality file inside the project. " +
      "Providers: codex (ChatGPT plan via Codex CLI, most reliable), chatgpt (chatgpt.com), flow (Google Flow, Nano Banana 2, usually 0 credits), gemini (gemini.google.com), " +
      "higgsfield (official CLI, costs credits: quote first), plus any JSON-defined site (call providers_list). " +
      "Without output_path the file goes to <project>/.ai-media/<provider>/. Look at the result yourself before using it. Pass fallback_providers to try others in order if the first one fails.",
    inputSchema: {
      provider: z.string().max(40),
      prompt: z.string().min(3).max(4000),
      output_path: z.string().max(500).optional().describe("Relative to the project, e.g. public/images/hero.png"),
      aspect: z.enum(ASPECTS).optional(),
      count: z.number().int().min(1).max(4).default(1).describe("Flow only"),
      quality: z.enum(["original", "upscaled"]).default("original").describe("Flow only"),
      model: z.string().max(60).optional().describe("Higgsfield only, e.g. nano_banana_2, gpt_image_2_5"),
      max_credits: z.number().int().min(0).max(5000).default(0).describe("Higgsfield only: quote first, then cap"),
      overwrite: z.boolean().default(false),
      fallback_providers: z.array(z.string().max(40)).max(4).optional().describe("Try these in order if the first provider fails (for example a site redesign broke a selector). Each attempt and why it failed is reported in the result."),
    },
  },
  async (a, extra: Extra) => {
    try {
      const candidates = [a.provider, ...(a.fallback_providers ?? [])];
      for (const c of candidates) if (!knownProvider(c)) throw new Error(`Unknown provider "${c}". Call providers_list.`);
      precheck(a.output_path, a.overwrite);
    } catch (e) {
      return fail(e);
    }

    /** One provider's actual image call. Returns the plain result data; throws on failure. Unchanged from before the fallback chain was added. */
    async function attemptImage(provider: string, onTick: (ms: number) => void, status: (msg: string) => void): Promise<Record<string, unknown>> {
      if (provider === "codex") {
        const r = await codexImage(a.prompt, a.aspect, extra.signal);
        return { saved: [save(r.data, "codex", a.prompt, a.output_path, a.overwrite)], via: r.note };
      }
      if (provider === "higgsfield") {
        if (a.max_credits < 1) throw new Error("Higgsfield images spend credits. Call video_quote with provider higgsfield and the image model, tell the user, then pass max_credits.");
        const r = await higgsfieldGenerate(a.model ?? "nano_banana_2", a.prompt, { aspect_ratio: a.aspect }, a.max_credits, extra.signal);
        const saved = [];
        for (const [i, u] of r.urls.entries()) saved.push(save(await downloadHttps(u, extra.signal), "higgsfield", a.prompt, numbered(a.output_path, i), a.overwrite));
        return { saved, credits: r.credits, via: "Higgsfield CLI" };
      }
      const page = await browser.page(extra.signal, status);
      try {
        if (provider === "chatgpt") {
          try {
            const r = await chatgptImage(page, a.prompt, a.aspect, onTick);
            return { saved: [save(r.data, "chatgpt", a.prompt, a.output_path, a.overwrite)], via: r.note };
          } catch (e) {
            const reply = await chatgptLastReply(page);
            throw new Error(`${(e as Error).message}${reply ? `\nChatGPT said: ${reply}` : ""}`);
          }
        }
        if (provider === "gemini") {
          const r = await geminiImage(page, a.prompt, cfg.googleEmail, onTick);
          return { saved: [save(r.data, "gemini", a.prompt, a.output_path, a.overwrite)], account: r.account };
        }
        if (provider === "flow") {
          const r = await flowGenerate(page, {
            email: cfg.googleEmail,
            prompt: a.prompt,
            model: "nano-banana-2",
            aspect: (a.aspect ?? "16:9") as Aspect,
            count: a.count as 1 | 2 | 3 | 4,
            maxCredits: 0,
            quality: a.quality,
            project: claimFlowProject(),
            onTick,
          });
          keepFlowProject(r.project);
          return { saved: r.files.map((buf, i) => save(buf, "flow", a.prompt, numbered(a.output_path, i), a.overwrite)), credits: r.credits, account: r.account };
        }
        const spec = specs.specs.find((s) => s.id === provider)!;
        const prompt = a.aspect ? `${a.prompt} (aspect ratio ${a.aspect})` : a.prompt;
        const data = await genericGenerate(page, spec, "image", prompt, onTick);
        return { saved: [save(data, spec.id, a.prompt, a.output_path, a.overwrite)], via: spec.name };
      } finally {
        await page.close().catch(() => undefined);
      }
    }

    return job(extra, a.provider, `${a.provider} image`, async (onTick, status) => {
      const candidates = [a.provider, ...(a.fallback_providers ?? [])];
      const tried: { provider: string; ok: boolean; reason?: string }[] = [];
      let lastError: Error | undefined;
      for (const provider of candidates) {
        const startedAt = Date.now();
        browser.lastWaitMs = 0;
        try {
          const result = await attemptImage(provider, onTick, status);
          // Time spent queued behind another session isn't part of how long the job itself takes.
          recordProviderOutcome(cfg.home, provider, true, undefined, undefined, Date.now(), Date.now() - startedAt - browser.lastWaitMs);
          return ok(tried.length ? { ...result, fallback_used: { attempted: [...tried, { provider, ok: true }] } } : result);
        } catch (e) {
          const message = (e as Error).message ?? String(e);
          const cls = classifyFailure(message);
          recordProviderOutcome(cfg.home, provider, false, cls, message);
          tried.push({ provider, ok: false, reason: `${cls}: ${message.slice(0, 200)}` });
          lastError = e as Error;
        }
      }
      const health = providerHealth(readReliability(cfg.home), a.provider).note;
      throw new Error(
        `Every provider failed: ${tried.map((t) => `${t.provider} (${t.reason})`).join("; ")}.${health ? ` ${health}` : ""}${lastError ? "" : ""}`,
      );
    }).catch(fail);
  },
);

server.registerTool(
  "video_quote",
  {
    title: "How many credits a generation will cost",
    description:
      "provider=flow: opens the Flow project, sets model and aspect, reads the cost Flow shows. " +
      "provider=higgsfield: asks the Higgsfield CLI for the exact cost of model + prompt (images or videos). Generates nothing.",
    inputSchema: {
      provider: z.enum(["flow", "higgsfield"]).default("flow"),
      model: z.string().max(60).default("veo-lite").describe(`flow: ${FLOW_VIDEO.join(", ")}. higgsfield: any job type, e.g. seedance_2_0, kling3_0, nano_banana_2`),
      prompt: z.string().max(4000).optional().describe("higgsfield: needed for an exact quote"),
      aspect: z.enum(ASPECTS).default("16:9"),
      count: z.number().int().min(1).max(4).default(1),
    },
  },
  async (a, extra: Extra) =>
    job(extra, "quote", `${a.provider} quote`, async (_onTick, status) => {
      if (a.provider === "higgsfield") {
        const model = a.model === "veo-lite" ? "seedance_2_0" : a.model;
        const credits = await higgsfieldCost(model, a.prompt ?? "test", { aspect_ratio: a.aspect });
        return ok({ provider: "higgsfield", model, credits, balance: (await higgsfieldStatus()).credits });
      }
      if (!FLOW_VIDEO.includes(a.model)) throw new Error(`Flow video models: ${FLOW_VIDEO.join(", ")}`);
      const page = await browser.page(extra.signal, status);
      try {
        const q = await flowQuote(page, { email: cfg.googleEmail, model: a.model as FlowModel, aspect: a.aspect, count: a.count as 1, project: claimFlowProject() });
        keepFlowProject(q.project);
        return ok({ credits: q.credits, model: a.model, aspect: a.aspect, count: a.count, account: q.account, tier: q.tier, lowCredits: q.lowCredits });
      } finally {
        await page.close().catch(() => undefined);
      }
    }).catch(fail),
);

server.registerTool(
  "video_generate",
  {
    title: "Generate a video with your own account",
    description:
      "provider=flow (default): Veo or Omni in Google Flow. provider=higgsfield: Seedance, Kling, Veo and more via the official CLI. " +
      "Both spend credits: call video_quote first, tell the user the cost, and pass max_credits. If the real cost is higher, nothing is generated. " +
      "JSON-defined sites (e.g. grok) show no price up front, so they need confirm_spend: true, which you may only set after the user agreed in chat.",
    inputSchema: {
      provider: z.string().max(40).default("flow"),
      confirm_spend: z.boolean().default(false),
      prompt: z.string().min(3).max(4000),
      model: z.string().max(60).default("veo-lite").describe(`flow: ${FLOW_VIDEO.join(", ")}. higgsfield: e.g. seedance_2_0, kling3_0`),
      aspect: z.enum(ASPECTS).default("16:9"),
      duration: z.number().int().min(1).max(60).optional().describe("Higgsfield only, seconds"),
      max_credits: z.number().int().min(0).max(5000).default(0).describe("flow and higgsfield: hard cap from video_quote"),
      quality: z.enum(["original", "upscaled"]).default("original"),
      output_path: z.string().max(500).optional(),
      overwrite: z.boolean().default(false),
    },
  },
  async (a, extra: Extra) => {
    try {
      if (!knownProvider(a.provider) || ["codex", "chatgpt", "gemini"].includes(a.provider)) throw new Error(`"${a.provider}" can't make videos. Use flow, higgsfield, or a JSON site with video support.`);
      if (a.provider === "flow" && !FLOW_VIDEO.includes(a.model)) throw new Error(`Flow video models: ${FLOW_VIDEO.join(", ")}`);
      precheck(a.output_path, a.overwrite);
    } catch (e) {
      return fail(e);
    }
    return job(extra, a.provider, `${a.provider} video`, async (onTick, status) => {
      if (a.provider === "higgsfield") {
        if (a.max_credits < 1) throw new Error("Higgsfield videos spend credits. Call video_quote with provider higgsfield, tell the user, then pass max_credits.");
        const model = a.model === "veo-lite" ? "seedance_2_0" : a.model;
        const r = await higgsfieldGenerate(model, a.prompt, { aspect_ratio: a.aspect, duration: a.duration }, a.max_credits, extra.signal);
        return ok({ saved: [save(await downloadHttps(r.urls[0], extra.signal), "higgsfield", a.prompt, a.output_path, a.overwrite)], credits: r.credits, model });
      }
      const page = await browser.page(extra.signal, status);
      try {
        if (a.provider !== "flow") {
          const spec = specs.specs.find((s) => s.id === a.provider)!;
          if (!a.confirm_spend) throw new Error(`${spec.name} does not show a price up front. Ask the user, then retry with confirm_spend: true.`);
          const data = await genericGenerate(page, spec, "video", `${a.prompt} (aspect ratio ${a.aspect})`, onTick);
          return ok({ saved: [save(data, spec.id, a.prompt, a.output_path, a.overwrite)], via: spec.name });
        }
        if (a.max_credits < 1) throw new Error("Flow videos spend credits. Call video_quote, tell the user, then pass max_credits.");
        const r = await flowGenerate(page, {
          email: cfg.googleEmail,
          prompt: a.prompt,
          model: a.model as FlowModel,
          aspect: a.aspect,
          count: 1,
          maxCredits: a.max_credits,
          quality: a.quality,
          project: claimFlowProject(),
          onTick,
        });
        keepFlowProject(r.project);
        return ok({ saved: [save(r.files[0], "flow", a.prompt, a.output_path, a.overwrite)], credits: r.credits, account: r.account });
      } finally {
        await page.close().catch(() => undefined);
      }
    }).catch(fail);
  },
);

function readHead(file: string, n = 64): Buffer {
  const fd = openSync(file, "r");
  try {
    const b = Buffer.alloc(n);
    readSync(fd, b, 0, n, 0);
    return b;
  } finally {
    closeSync(fd);
  }
}

const AUDIO_EXTS = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac"]);

/** An input file: must be inside the project and really be what it claims (media by bytes, srt/audio by extension and size). */
function resolveInput(p: string, kind: "media" | "audio" | "srt" = "media") {
  const root = realpathSync(cfg.outputRoots[0]);
  const file = realpathSync(resolve(root, p));
  if (!cfg.outputRoots.some((r) => isInside(file, realpathSync(r)))) throw new Error(`Input must be inside the project: ${p}`);
  const ext = extname(file).toLowerCase();
  if (kind === "srt") {
    if (ext !== ".srt") throw new Error("Subtitles must be an .srt file.");
  } else if (kind === "audio") {
    if (!AUDIO_EXTS.has(ext) && !sniff(readHead(file))?.mime.startsWith("video/")) throw new Error("Audio must be mp3, wav, m4a, aac, ogg, opus or flac.");
  } else {
    if (!sniff(readHead(file))) throw new Error(`Not a real image or video file: ${p}`);
  }
  return { root, file };
}

function outputFor(root: string, input: string, wanted: string | undefined, suffix: string, ext: string, overwrite: boolean) {
  const def = relative(root, input).replace(/\.\w+$/, `${suffix}${ext}`);
  const out = resolveOutput({ roots: cfg.outputRoots, outputPath: wanted ?? def, provider: "edit", prompt: "", ext, overwrite });
  mkdirSync(dirname(out), { recursive: true });
  return out;
}

server.registerTool(
  "media_probe",
  {
    title: "What's in a media file",
    description: "Duration, size, frame rate and codecs of an image or video inside the project.",
    inputSchema: { input_path: z.string().max(500) },
  },
  async (a) => {
    try {
      const { file } = resolveInput(a.input_path);
      return ok({ file: a.input_path, bytes: statSync(file).size, ...(await probe(file)) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "background_remove",
  {
    title: "Remove the background from an image",
    description:
      "Cuts out the subject and saves a transparent PNG, fully on this computer with rembg and BiRefNet models (no upload, no API). " +
      "quality: fast (BiRefNet lite, default), best (BiRefNet general, slower, ~1 GB model on first use), portrait (people), anime. " +
      "The first run downloads the model once. Needs rembg: uv tool install \"rembg[cpu,cli]\".",
    inputSchema: {
      input_path: z.string().max(500),
      output_path: z.string().max(500).optional().describe("Default: <name>-cutout.png next to the input"),
      quality: z.enum(["fast", "best", "portrait", "anime"]).default("fast"),
      overwrite: z.boolean().default(false),
    },
  },
  async (a, extra: Extra) => {
    try {
      const { root, file } = resolveInput(a.input_path);
      if (!sniff(readHead(file))?.mime.startsWith("image/")) throw new Error("Background removal works on images.");
      const out = outputFor(root, file, a.output_path, "-cutout", ".png", a.overwrite);
      if (extname(out).toLowerCase() !== ".png") throw new Error("The cutout must be saved as .png to keep transparency.");
      return await job(extra, "rembg", "background removal", async () => {
        await removeBackground(file, out, a.quality, cfg.home, extra.signal);
        const buf = readFileSync(out);
        return ok({ output: relative(root, out), bytes: buf.length, ...imageSize(buf), quality: a.quality });
      }, localGate).catch(fail);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "social_sizes",
  {
    title: "Make every social and web size from one image",
    description:
      "From one image, makes the sizes people need: Open Graph, LinkedIn, X (post and profile header), Instagram square/portrait/story, " +
      "YouTube thumbnail and channel banner, Facebook cover and event cover, Pinterest, TikTok profile, GitHub social preview, favicon and app icons. " +
      "fit: cover (fill and crop, photos), contain (whole image on a blurred copy of itself, logos and posters), pad (whole image on a solid colour). " +
      "Facebook and YouTube cover/banner sizes get cropped differently on different devices: keep the subject and any text centred in the middle third so it survives every crop. " +
      "Files go to the output folder named after each preset.",
    inputSchema: {
      input_path: z.string().max(500),
      presets: z.array(z.enum(Object.keys(SOCIAL_PRESETS) as [SocialPreset, ...SocialPreset[]])).optional().describe("Default: all"),
      fit: z.enum(["cover", "contain", "pad"]).default("cover").describe("cover (default) fills the frame; contain adds a blurred copy behind, which can look like padding; pad uses a solid colour"),
      pad_color: z.string().regex(/^(#?[0-9a-fA-F]{6}|black|white)$/).default("#0b1020"),
      output_dir: z.string().max(400).optional().describe("Default: <input folder>/<name>-sizes"),
      overwrite: z.boolean().default(false),
    },
  },
  async (a, extra: Extra) => {
    try {
      const { root, file } = resolveInput(a.input_path);
      if (!sniff(readHead(file))?.mime.startsWith("image/")) throw new Error("social_sizes works on images.");
      const base = basename(file).replace(/\.\w+$/, "");
      const dir = a.output_dir ?? join(relative(root, dirname(file)), `${base}-sizes`);
      const presets = a.presets ?? DEFAULT_PRESETS;
      const color = a.pad_color.startsWith("#") ? `0x${a.pad_color.slice(1)}` : /^[0-9a-fA-F]{6}$/.test(a.pad_color) ? `0x${a.pad_color}` : a.pad_color;
      // Validate every target before writing anything.
      const targets = new Map(presets.map((p) => [p, resolveOutput({ roots: cfg.outputRoots, outputPath: join(dir, `${p}${SOCIAL_PRESETS[p].ext}`), provider: "edit", prompt: "", ext: SOCIAL_PRESETS[p].ext, overwrite: a.overwrite })]));
      const p = progress(extra, "social sizes");
      try {
        const r = await socialSizes(file, (preset) => targets.get(preset)!, presets, a.fit, color);
        return ok({ made: r.map((x) => ({ ...x, file: relative(root, x.file) })) });
      } finally {
        p.done();
      }
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "contact_sheet",
  {
    title: "Lay out drafts side by side for comparison",
    description:
      `Puts up to ${CONTACT_SHEET_MAX} draft images (for example several directions from image_generate, or a few iterations of the same one) on a single grid, so they can be judged against ` +
      "each other instead of one at a time. No text is drawn onto the image; the result instead lists which grid position holds which file, in reading order (left to right, top to bottom).",
    inputSchema: {
      input_paths: z.array(z.string().max(500)).min(1).max(CONTACT_SHEET_MAX).describe("Draft files, relative to the project"),
      output_path: z.string().max(500).describe("Where the grid image is saved, e.g. .ai-media/compare/hero-drafts.jpg"),
      columns: z.number().int().min(1).max(6).optional().describe("Default: a roughly square grid"),
      overwrite: z.boolean().default(false),
    },
  },
  async (a, extra: Extra) => {
    try {
      const root = realpathSync(cfg.outputRoots[0]);
      const files = a.input_paths.map((p) => resolveInput(p).file);
      precheck(a.output_path, a.overwrite);
      const out = resolveOutput({ roots: cfg.outputRoots, outputPath: a.output_path, provider: "contact-sheet", prompt: "", ext: ".jpg", overwrite: a.overwrite });
      const p = progress(extra, "contact sheet");
      try {
        const r = await contactSheet(files, out, a.columns);
        return ok({ file: relative(root, out), cols: r.cols, rows: r.rows, width: r.width, height: r.height, tiles: r.tiles.map((t) => ({ index: t.index, file: relative(root, t.file) })) });
      } finally {
        p.done();
      }
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "loop_check",
  {
    title: "Check a looping video for a visible seam",
    description:
      "For a background-video or product-video meant to loop: compares its first and last frame with the same structural-similarity check media_optimize uses for quality loss, and reports whether it will " +
      "look seamless on repeat. A low similarity means a visible jump or jerk when it loops; regenerate with a direction that explicitly brings the motion back to where it started.",
    inputSchema: {
      input_path: z.string().max(500),
    },
  },
  async (a) => {
    try {
      const { file } = resolveInput(a.input_path);
      if (!sniff(readHead(file))?.mime.startsWith("video/")) throw new Error("loop_check works on videos.");
      const r = await loopCheck(file);
      return ok(r);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "palette_extract",
  {
    title: "Pull a website colour palette from an image",
    description:
      "Reads the dominant colours out of a real image (a generated hero, banner or any photo) and returns them as hex codes with their share of the image, plus a ready :root CSS custom-properties block. " +
      "This is a colour histogram, not a brand decision: it names the colours --palette-1, --palette-2 and so on by how much of the image they cover, most dominant first. Decide yourself which one is the " +
      "primary, the accent or the background before wiring it into a stylesheet.",
    inputSchema: {
      input_path: z.string().max(500),
      count: z.number().int().min(1).max(12).default(6),
    },
  },
  async (a) => {
    try {
      const { file } = resolveInput(a.input_path);
      if (!sniff(readHead(file))?.mime.startsWith("image/")) throw new Error("palette_extract works on images.");
      const colors = await dominantColors(file, a.count);
      return ok({ colors, css: cssVariables(colors) });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "deliver",
  {
    title: "Make the final file for a platform",
    description:
      "One step from a finished image to the file a platform wants: exact size (cropped to fill), JPEG at the lowest quality that still looks identical (SSIM), metadata stripped, " +
      "under the platform's file-size limit, then checked for an empty band. Platforms: " +
      Object.entries(PLATFORMS).map(([k, v]) => `${k} (${v.w}x${v.h}, ${v.note})`).join("; ") + ".",
    inputSchema: {
      input_path: z.string().max(500),
      platform: z.enum(Object.keys(PLATFORMS) as [Platform, ...Platform[]]),
      output_path: z.string().max(500).optional().describe("Default: <input folder>/<name>-<platform>.jpg"),
      overwrite: z.boolean().default(false),
    },
  },
  async (a, extra: Extra) => {
    try {
      const { root, file } = resolveInput(a.input_path);
      if (!sniff(readHead(file))?.mime.startsWith("image/")) throw new Error("deliver works on images.");
      const spec = PLATFORMS[a.platform];
      const def = join(relative(root, dirname(file)), `${basename(file).replace(/\.\w+$/, "")}-${a.platform}.jpg`);
      const out = resolveOutput({ roots: cfg.outputRoots, outputPath: a.output_path ?? def, provider: "deliver", prompt: "", ext: ".jpg", overwrite: a.overwrite });
      mkdirSync(dirname(out), { recursive: true });
      const p = progress(extra, `deliver ${a.platform}`);
      try {
        const r = await encodeAtSize(file, out, spec.w, spec.h, "cover", { maxBytes: spec.maxBytes });
        const c = await compositionCheck(out);
        markDraft(root, file, { status: "used", final: relative(root, out).split("\\").join("/") });
        return ok({
          file: relative(root, out),
          platform: a.platform,
          width: r.width,
          height: r.height,
          bytes: r.bytes,
          withinLimit: r.bytes <= spec.maxBytes,
          ssim: r.ssim,
          setting: r.setting,
          composition: { verdict: c.verdict, bands: c.bands, note: c.note },
          note: spec.note,
        });
      } finally {
        p.done();
      }
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "compose",
  {
    title: "Set the real headline and logo over generated art",
    description:
      "Renders a headline (and an optional sub line) and a registered brand's real logo over a generated image, the careful way every time: the calmest corner is measured and gets the text, " +
      "the logo takes the calmest bottom corner left, text colour and a soft scrim are chosen for at least 4.5:1 contrast, the brand's display font (or the brief's) is used, one colour, no glow, no eyebrow label. " +
      "A logo on its own dark tile gets a feathered edge so it doesn't look boxed. Saves a PNG; run deliver on it for the platform. Opens a tab in the server's browser to render.",
    inputSchema: {
      input_path: z.string().max(500).describe("The generated art, relative to the project"),
      headline: z.string().min(1).max(80),
      subline: z.string().max(140).optional(),
      brand_id: z.string().max(40).optional().describe("A brand from brand_profiles; its logo and fonts are used. Leave out for text only"),
      platform: z.enum(Object.keys(PLATFORMS) as [Platform, ...Platform[]]).optional().describe("Crop the art to this platform's size first, so the text margins are right in the final file"),
      text_corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional().describe("Default: the calmest corner, measured"),
      logo_corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
      heading_font: z.string().max(60).optional().describe("Default: the brand's, else Space Grotesk"),
      body_font: z.string().max(60).optional(),
      output_path: z.string().max(500).optional().describe("Default: <input folder>/<name>-composed.png"),
      overwrite: z.boolean().default(false),
    },
  },
  async (a, extra: Extra) => {
    try {
      const { root, file: source } = resolveInput(a.input_path);
      if (!sniff(readHead(source))?.mime.startsWith("image/")) throw new Error("compose works on images.");
      // With a platform, compose at the final size: cropping after setting text would cut into its margins.
      let file = source;
      if (a.platform) {
        const spec = PLATFORMS[a.platform];
        file = join(mkdtempSync(join(tmpdir(), "noapi-compose-")), "art.png");
        await encodeAtSize(source, file, spec.w, spec.h, "cover", { png: true });
      }
      const kind = sniff(readHead(file))!;
      const info = await probe(file);
      if (!info.width || !info.height) throw new Error("Could not read the image size.");
      if (info.width * info.height > 40_000_000) throw new Error("That image is too large to compose; resize it first.");
      const brand = a.brand_id ? getBrand(cfg.home, a.brand_id) : undefined;
      if (a.brand_id && !brand) throw new Error(`No brand "${a.brand_id}". Registered: ${readBrands(cfg.home).map((b) => b.id).join(", ") || "none yet"}.`);
      const g = await sampleGrey(file);
      const stats = cornerStats(g.lum, g.w, g.h);
      const place = placeTextAndLogo(stats, a.text_corner as Corner | undefined, a.logo_corner as Corner | undefined);
      const region = stats.find((s) => s.corner === place.text)!;
      const style = textStyleFor(region);
      const logoRegion = stats.find((s) => s.corner === place.logo)!;
      const logoFile = brand?.logo ? (logoRegion.mean < 140 ? brand.logo.dark ?? brand.logo.light : brand.logo.light ?? brand.logo.dark) : undefined;
      let logo: { dataUrl: string; corner: Corner; tile: boolean } | undefined;
      if (logoFile) {
        const head = readHead(logoFile);
        const lk = sniff(head);
        if (!lk?.mime.startsWith("image/") || statSync(logoFile).size > 8 * 1024 * 1024) throw new Error(`The brand's logo file isn't a usable image: ${logoFile}`);
        logo = { dataUrl: `data:${lk.mime};base64,${readFileSync(logoFile).toString("base64")}`, corner: place.logo, tile: await logoHasTile(logoFile) };
      }
      const fonts = brand?.fonts;
      const html = composeHtml({
        width: info.width,
        height: info.height,
        artDataUrl: `data:${kind.mime};base64,${readFileSync(file).toString("base64")}`,
        headline: a.headline,
        subline: a.subline,
        heading: a.heading_font ?? fonts?.heading ?? "Space Grotesk",
        body: a.body_font ?? fonts?.body ?? "DM Sans",
        googleFontsUrl: a.heading_font || a.body_font
          ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(a.heading_font ?? "Space Grotesk")}:wght@700&family=${encodeURIComponent(a.body_font ?? "DM Sans")}:wght@500&display=swap`
          : fonts?.googleFontsUrl ?? "https://fonts.googleapis.com/css2?family=DM+Sans:wght@500&family=Space+Grotesk:wght@700&display=swap",
        text: place.text,
        logo,
        style,
        textWidth: calmWidth(g.lum, g.w, g.h, place.text),
      });
      const def = join(relative(root, dirname(source)), `${basename(source).replace(/\.\w+$/, "")}-composed${a.platform ? `-${a.platform}` : ""}.png`);
      const out = resolveOutput({ roots: cfg.outputRoots, outputPath: a.output_path ?? def, provider: "compose", prompt: "", ext: ".png", overwrite: a.overwrite });
      mkdirSync(dirname(out), { recursive: true });
      return await job(extra, "compose", "compose", async (_t, status) => {
        const page = await browser.page(extra.signal, status);
        try {
          await page.setViewportSize({ width: info.width!, height: info.height! });
          await page.setContent(html, { waitUntil: "load", timeout: 30_000 });
          await page.evaluate(() => document.fonts.ready).catch(() => undefined);
          const headingFont = a.heading_font ?? fonts?.heading ?? "Space Grotesk";
          const fontLoaded = await page.evaluate((f) => document.fonts.check(`700 48px "${f}"`), headingFont).catch(() => false);
          const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: info.width!, height: info.height! } });
          writeFileSync(out, png);
          return ok({
            file: relative(root, out),
            placement: place,
            contrast: style.contrast,
            textColor: style.color,
            logo: logoFile ? { file: logoFile, feathered: logo?.tile ?? false } : "none (pass brand_id to add one)",
            headingFont: fontLoaded ? headingFont : `${headingFont} didn't load (offline?); a system sans was used`,
            next: "Look at it, run design_audit with this file, then deliver it for the platform.",
          });
        } finally {
          await page.close().catch(() => undefined);
        }
      });
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "usage_report",
  {
    title: "Local usage summary",
    description:
      "Totals up this project's own .ai-media/manifest.jsonl: how many images and videos were generated, by which provider, in what format, and on which days. " +
      "Nothing is uploaded; this only reads what the server already wrote to disk while saving each result.",
    inputSchema: {
      since_days: z.number().int().min(1).max(3650).optional().describe("Only count the last N days. Default: everything on record."),
    },
  },
  async (a) => {
    try {
      const root = realpathSync(cfg.outputRoots[0]);
      return ok(usageReport(readManifest(root), a.since_days));
    } catch (e) {
      return fail(e);
    }
  },
);

const OPS = ["trim", "reframe", "speed", "fade", "mute", "replace_audio", "extract_frame", "gif", "text", "logo", "subtitles", "concat"] as const;

server.registerTool(
  "video_edit",
  {
    title: "Edit a video (or put text/logo on an image)",
    description:
      "One operation per call, all local with ffmpeg: trim (start, end), reframe (aspect 9:16/1:1/16:9/4:5/4:3, fit cover|contain), speed (factor), " +
      "fade (fade_in, fade_out seconds), mute, replace_audio (audio_path), extract_frame (at seconds, e.g. a poster image), gif (start, duration, width, fps), " +
      "text (text, position top|center|bottom, size, color, box) on a video or image, logo (logo_path, position, width_percent) on a video or image, " +
      "subtitles (srt_path, burned in), concat (others: more clips joined after this one). Chain calls for several edits.",
    inputSchema: {
      input_path: z.string().max(500),
      operation: z.enum(OPS),
      output_path: z.string().max(500).optional(),
      overwrite: z.boolean().default(false),
      start: z.number().min(0).max(36_000).optional(),
      end: z.number().min(0).max(36_000).optional(),
      duration: z.number().min(0.1).max(60).optional(),
      at: z.number().min(0).max(36_000).optional(),
      aspect: z.enum(["9:16", "1:1", "16:9", "4:5", "4:3"]).optional(),
      fit: z.enum(["cover", "contain"]).default("cover"),
      factor: z.number().min(0.1).max(10).optional(),
      fade_in: z.number().min(0).max(30).default(0),
      fade_out: z.number().min(0).max(30).default(0),
      audio_path: z.string().max(500).optional(),
      width: z.number().int().min(64).max(1920).default(640),
      fps: z.number().int().min(1).max(30).default(12),
      text: z.string().max(300).optional(),
      position: z.enum(["top", "center", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"]).optional(),
      size: z.number().int().min(10).max(300).default(64),
      color: z.string().regex(/^(#[0-9a-fA-F]{6}|white|black|yellow|red|cyan)$/).default("white"),
      box: z.boolean().default(true),
      logo_path: z.string().max(500).optional(),
      width_percent: z.number().min(2).max(60).default(15),
      srt_path: z.string().max(500).optional(),
      others: z.array(z.string().max(500)).max(20).optional(),
    },
  },
  async (a, extra: Extra) => {
    try {
      const { root, file } = resolveInput(a.input_path);
      const isImage = sniff(readHead(file))!.mime.startsWith("image/");
      const need = <T,>(v: T | undefined, name: string): T => {
        if (v === undefined || v === null || v === "") throw new Error(`${a.operation} needs ${name}.`);
        return v;
      };
      if (isImage && !["text", "logo"].includes(a.operation)) throw new Error(`${a.operation} works on videos. For images use text or logo.`);
      const vidExt = isImage ? extname(file).toLowerCase().replace(".jpeg", ".jpg") : ".mp4";
      const col = a.color.startsWith("#") ? `0x${a.color.slice(1)}` : a.color;
      let op: VideoOp;
      let ext = vidExt;
      switch (a.operation) {
        case "trim": op = { op: "trim", start: a.start ?? 0, end: a.end }; break;
        case "reframe": op = { op: "reframe", aspect: need(a.aspect, "aspect"), fit: a.fit }; break;
        case "speed": op = { op: "speed", factor: need(a.factor, "factor") }; break;
        case "fade": op = { op: "fade", fadeIn: a.fade_in, fadeOut: a.fade_out }; break;
        case "mute": op = { op: "mute" }; break;
        case "replace_audio": op = { op: "replace_audio", audio: resolveInput(need(a.audio_path, "audio_path"), "audio").file }; break;
        case "extract_frame": op = { op: "extract_frame", at: a.at ?? 0 }; ext = ".jpg"; break;
        case "gif": op = { op: "gif", start: a.start ?? 0, duration: a.duration ?? 4, width: a.width, fps: a.fps }; ext = ".gif"; break;
        case "text": {
          const pos = a.position ?? "bottom";
          if (!["top", "center", "bottom"].includes(pos)) throw new Error("text position must be top, center or bottom.");
          op = { op: "text", text: need(a.text, "text"), position: pos as "top" | "center" | "bottom", size: a.size, color: col, box: a.box };
          break;
        }
        case "logo": {
          const pos = a.position ?? "bottom-right";
          if (!["top-left", "top-right", "bottom-left", "bottom-right"].includes(pos)) throw new Error("logo position must be a corner.");
          op = { op: "logo", logo: resolveInput(need(a.logo_path, "logo_path")).file, position: pos as "top-left", widthPercent: a.width_percent };
          break;
        }
        case "subtitles": op = { op: "subtitles", srt: resolveInput(need(a.srt_path, "srt_path"), "srt").file }; break;
        case "concat": op = { op: "concat", others: need(a.others, "others").map((o) => resolveInput(o).file) }; break;
      }
      const out = outputFor(root, file, a.output_path, `-${a.operation.replace("_", "-")}`, ext, a.overwrite);
      return await job(extra, "edit", `video_edit ${a.operation}`, async () => {
        await videoEdit(file, op, out);
        const info = await probe(out).catch(() => ({}));
        return ok({ output: relative(root, out), bytes: statSync(out).size, ...info });
      }, localGate).catch(fail);
    } catch (e) {
      return fail(e);
    }
  },
);

server.registerTool(
  "media_optimize",
  {
    title: "Shrink an image or video for the web without visible loss",
    description:
      "Images to WebP by default, or JPEG/PNG with format (or a .jpg/.png output_path), for places like LinkedIn post uploads that don't take WebP. Videos to H.264 with faststart. Raises quality until SSIM (similarity to the original) reaches the target, " +
      "so the size drops but the picture does not visibly change. The original is kept untouched. " +
      "Behaviour notice: by default the output has embedded metadata stripped (EXIF, XMP, C2PA content credentials, text chunks), " +
      "like most web image optimizers; the result lists what was removed. Pass keep_metadata: true to keep what re-encoding can carry. " +
      "Invisible watermarks such as SynthID are never touched.",
    inputSchema: {
      input_path: z.string().max(500),
      output_path: z.string().max(500).optional().describe("Default: same folder, .webp for images (or the chosen format), -web.mp4 for videos"),
      format: z.enum(["webp", "jpg", "png"]).optional().describe("Image output format. Default: from output_path's extension, else webp"),
      max_width: z.number().int().min(64).max(7680).optional(),
      keep_audio: z.boolean().default(false),
      keep_metadata: z.boolean().default(false).describe("true: don't strip embedded metadata from the output (EXIF/XMP/C2PA). Default follows config strip_ai_metadata (on)."),
      overwrite: z.boolean().default(false),
    },
  },
  async (a, extra: Extra) => {
    try {
      const root = realpathSync(cfg.outputRoots[0]);
      const input = realpathSync(resolve(root, a.input_path));
      if (!cfg.outputRoots.some((r) => isInside(input, realpathSync(r)))) throw new Error("Input must be inside the project.");
      if (!MEDIA_EXTS.has(extname(input).toLowerCase())) throw new Error("Input is not a media file.");
      // Trust the bytes, not the name: a playlist renamed to .mp4 could make ffmpeg fetch other files.
      const kind = sniff(readHead(input));
      if (!kind) throw new Error("Input is not a real image or video file.");
      const isVideo = kind.mime.startsWith("video/");
      const fromPath = formatFromPath(a.output_path);
      if (a.format && fromPath && a.format !== fromPath) throw new Error(`format is ${a.format} but output_path ends in .${fromPath}. Make them agree.`);
      const format: ImageFormat = a.format ?? fromPath ?? "webp";
      const imgExt = `.${format}`;
      // Same extension as the input: add -web so the original is never overwritten.
      const defOut = isVideo ? input.replace(/\.\w+$/, "-web.mp4") : input.replace(/\.\w+$/, extname(input).toLowerCase() === imgExt ? `-web${imgExt}` : imgExt);
      const out = resolveOutput({
        roots: cfg.outputRoots,
        outputPath: a.output_path ?? relative(root, defOut),
        provider: "optimize",
        prompt: "",
        ext: isVideo ? ".mp4" : imgExt,
        overwrite: a.overwrite,
      });
      mkdirSync(dirname(out), { recursive: true });
      const p = progress(extra, "optimize");
      try {
        const strip = a.keep_metadata ? false : cfg.stripAiMetadata;
        const r = isVideo
          ? await optimizeVideo(input, out, { maxWidth: a.max_width, keepAudio: a.keep_audio, strip })
          : await optimizeImage(input, out, a.max_width, undefined, strip, format);
        const notice = firstTimeNotice();
        markDraft(root, input, { status: "used", final: relative(root, r.output).split("\\").join("/") });
        return ok({ ...r, output: relative(root, r.output), ...(notice ? { notice } : {}) });
      } finally {
        p.done();
      }
    } catch (e) {
      return fail(e);
    }
  },
);

process.on("SIGINT", () => void browser.close().then(() => process.exit(0)));
process.on("SIGTERM", () => void browser.close().then(() => process.exit(0)));
process.stdin.on("close", () => void browser.close());

await server.connect(new StdioServerTransport());
log(`no-api-media-mcp ${VERSION} ready. Output roots:`, cfg.outputRoots.join(", "));
