#!/usr/bin/env node
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup } from "./setup.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Browser } from "./browser.js";
import { loadConfig, readConfigFile, readState, STRIP_NOTICE, trustSystemCertificates, writeConfigFile, writeState } from "./config.js";
import { optimizeImage, optimizeVideo } from "./optimize.js";
import { chatgptImage, chatgptLastReply, chatgptStatus } from "./providers/chatgpt.js";
import { codexImage, codexStatus } from "./providers/codex.js";
import { genericGenerate, genericStatus, loadSpecs } from "./providers/generic.js";
import { downloadHttps, higgsfieldCost, higgsfieldGenerate, higgsfieldLogin, higgsfieldStatus } from "./providers/higgsfield.js";
import { flowGenerate, flowQuote, flowStatus, geminiImage, type Aspect, type FlowModel } from "./providers/google.js";
import { imageSize, isInside, JobGate, log, MEDIA_EXTS, redact, resolveOutput, sniff } from "./safety.js";
import { ASSET_TYPES, AUDIT_RUBRIC, auditScores, designBrief, LOOKS, type Look } from "./design.js";
import { autoCleanup, cleanup, DEFAULT_DAYS, markDraft } from "./housekeeping.js";
import { autoInstall, checkForUpdate, updateNotice } from "./update.js";
import { learnedFor, learnedSentence, readJournal, record } from "./learning.js";
import { lessonsFor } from "./lessons.js";
import { projectProfile, TIERS } from "./project.js";
import { probe, removeBackground, SOCIAL_PRESETS, socialSizes, videoEdit, type SocialPreset, type VideoOp } from "./edit.js";

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
  const KEYS = ["strip_ai_metadata", "auto_cleanup"];
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
    process.stdout.write(`strip_ai_metadata = ${cfg.stripAiMetadata}   (from ${source})\nauto_cleanup = ${cfg.autoCleanup}   (old rejected and used drafts in .ai-media are removed after a grace period; NOAPI_AUTO_CLEANUP=0 turns it off)\nconfig file: ${join(cfg.home, "config.json")}\n`);
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

When the user asks for any image or video for their project, do this without asking them to write prompts:
1. Call project_profile. Open the reference images it lists to see the current look.
2. Decide the slots yourself: where the asset goes (hero, OG image, feature icons, background video...), size, file path in the project's asset folder.
3. Call design_brief like a creative director briefing a designer: asset type, subject, brand colours, style tier, and a full "context" (project name, what it does from project_profile.about, who sees it, where it goes, what it must achieve, and exactText for any words). Quality defaults to premium. If the user named a level ("premium", "glowing", "minimal", "luxury 3D"), that wins.
4. Generate the brief's directions with image_generate. Designs with words (infographic, poster, logo with wordmark) go to "codex" first (GPT Image renders text best), then "flow". Photo and 3D scenes go to "flow" (Nano Banana 2, 0 credits on AI Pro). Save drafts into .ai-media (no output_path).
5. Look at every result yourself and score it against the brief's critique list, then run the eye-catch audit: score each criterion 0 to 5 and call design_audit. Rewrite the prompt for the exact failures it names and retry, at most 3 rounds. Ship only on "ship".
   Words and numbers that must be exact (a terminal command, a results table, a diagram with labels) are better drawn locally as SVG or HTML and rendered than asked from an image model. Use the image model for the art around them.
   Never generate the user's own logo or a third party's logo. Place the real logo file from the project after generation. A named third-party product (for example a security platform) is shown through colour and motif only, with an "independent project" note on public assets.
6. Show the user a shortlist with one line of reasoning each before placing anything, unless they told you to just do it.
   Pass asset_type and the draft's file to design_audit, so the server learns what keeps going wrong and a rejected draft can be cleaned up later. design_brief already carries "learned" advice from earlier audits and built-in lessons: follow them on the first try.
   Always set context.targetAspect to the shape the image will finally be cropped to (a profile banner is about 3.2:1).
   Compose real logos and text over generated art yourself: a black-background logo goes on a dark glass plate or a feathered mask, never plain screen blending.
   design_brief also suggests a brand palette and a heading/body Google Fonts pairing when you didn't supply your own (curated, not invented). Load that font pairing's Google Fonts URL in the HTML you render for the wordmark and any composited text, instead of a generic system font: a real display font is most of what separates a premium banner from a plain one.
7. media_optimize the winner into the real asset folder (the project's own images folder, never leave a final in .ai-media), wire it into the code with width, height and real alt text, then check the page. Drafts in .ai-media are cleaned up on their own: rejected ones after a few days, used ones after a couple of weeks (media_cleanup shows or does it on demand).
   media_optimize strips embedded metadata (EXIF, XMP, C2PA content credentials) from its output by default and reports what it removed; if the user wants provenance kept, pass keep_metadata: true. It never touches invisible watermarks.
For videos: always call video_quote first, tell the user the credit cost, and pass max_credits. Never solve captchas; if a site asks for a human check or a sign-in, tell the user to run accounts_login.`;

const server = new McpServer({ name: "no-api-media-mcp", version: VERSION }, { instructions: INSTRUCTIONS });
const specs = loadSpecs(cfg.home);
if (specs.errors.length) log("ignored provider specs:", specs.errors.join("; "));

const ASPECTS = ["16:9", "4:3", "1:1", "3:4", "9:16"] as const;
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
    done: () => clearInterval(beat),
  };
}

/** Run a generation job: one at a time, with progress, cancellation and the heartbeat cleaned up. */
function job<T>(extra: Extra, key: string, label: string, fn: (onTick: (ms: number) => void) => Promise<T>, g: JobGate = gate) {
  const p = progress(extra, label);
  return g
    .run(key, async () => {
      if (extra.signal.aborted) throw new Error("Cancelled");
      return fn(p.onTick);
    })
    .finally(p.done);
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
        })
        .default({}),
    },
  },
  async (a) => {
    const items = learnedFor(readJournal(cfg.home), a.asset_type);
    return ok(designBrief(a.asset_type, a.subject, a.brand, a.style, a.context, { learned: learnedSentence(items), learnedItems: items, lessons: lessonsFor(a.asset_type) }));
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
      "Pass file (the draft inside .ai-media) so a revise marks it rejected, which lets it be cleaned up later, and a ship marks it shortlisted.",
    inputSchema: {
      scores: z.record(z.string().max(30), z.number().min(0).max(5)).default({}),
      asset_type: z.enum(ASSET_TYPES).optional(),
      file: z.string().max(500).optional().describe("The draft you scored, relative to the project, e.g. .ai-media/codex/banner.png"),
    },
  },
  async (a) => {
    try {
      if (!Object.keys(a.scores).length) return ok({ criteria: AUDIT_RUBRIC.map((r) => ({ id: r.id, ask: r.ask })), pass: "average 4 or more, nothing below 3" });
      const result = auditScores(a.scores);
      if (a.asset_type) record(cfg.home, { asset: a.asset_type, scores: a.scores, average: result.average, verdict: result.verdict });
      let marked: string | undefined;
      if (a.file) {
        const root = realpathSync(cfg.outputRoots[0]);
        const abs = realpathSync(resolve(root, a.file));
        if (isInside(abs, join(root, ".ai-media")) && markDraft(root, abs, { status: result.verdict === "ship" ? "shortlisted" : "rejected", note: `audit average ${result.average}` })) {
          marked = result.verdict === "ship" ? "shortlisted" : "rejected";
        }
      }
      return ok({ ...result, ...(marked ? { draft: marked } : {}) });
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
      "Without output_path the file goes to <project>/.ai-media/<provider>/. Look at the result yourself before using it.",
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
    },
  },
  async (a, extra: Extra) => {
    try {
      if (!knownProvider(a.provider)) throw new Error(`Unknown provider "${a.provider}". Call providers_list.`);
      precheck(a.output_path, a.overwrite);
    } catch (e) {
      return fail(e);
    }
    return job(extra, a.provider, `${a.provider} image`, async (onTick) => {
      if (a.provider === "codex") {
        const r = await codexImage(a.prompt, a.aspect, extra.signal);
        return ok({ saved: [save(r.data, "codex", a.prompt, a.output_path, a.overwrite)], via: r.note });
      }
      if (a.provider === "higgsfield") {
        if (a.max_credits < 1) throw new Error("Higgsfield images spend credits. Call video_quote with provider higgsfield and the image model, tell the user, then pass max_credits.");
        const r = await higgsfieldGenerate(a.model ?? "nano_banana_2", a.prompt, { aspect_ratio: a.aspect }, a.max_credits, extra.signal);
        const saved = [];
        for (const [i, u] of r.urls.entries()) saved.push(save(await downloadHttps(u, extra.signal), "higgsfield", a.prompt, numbered(a.output_path, i), a.overwrite));
        return ok({ saved, credits: r.credits, via: "Higgsfield CLI" });
      }
      const page = await browser.page(extra.signal);
      try {
        if (a.provider === "chatgpt") {
          try {
            const r = await chatgptImage(page, a.prompt, a.aspect, onTick);
            return ok({ saved: [save(r.data, "chatgpt", a.prompt, a.output_path, a.overwrite)], via: r.note });
          } catch (e) {
            const reply = await chatgptLastReply(page);
            throw new Error(`${(e as Error).message}${reply ? `\nChatGPT said: ${reply}` : ""}`);
          }
        }
        if (a.provider === "gemini") {
          const r = await geminiImage(page, a.prompt, cfg.googleEmail, onTick);
          return ok({ saved: [save(r.data, "gemini", a.prompt, a.output_path, a.overwrite)], account: r.account });
        }
        if (a.provider === "flow") {
          const r = await flowGenerate(page, {
            email: cfg.googleEmail,
            prompt: a.prompt,
            model: "nano-banana-2",
            aspect: (a.aspect ?? "16:9") as Aspect,
            count: a.count as 1 | 2 | 3 | 4,
            maxCredits: 0,
            quality: a.quality,
            project: readState(cfg).flowProject,
            onTick,
          });
          writeState(cfg, { flowProject: r.project });
          return ok({ saved: r.files.map((buf, i) => save(buf, "flow", a.prompt, numbered(a.output_path, i), a.overwrite)), credits: r.credits, account: r.account });
        }
        const spec = specs.specs.find((s) => s.id === a.provider)!;
        const prompt = a.aspect ? `${a.prompt} (aspect ratio ${a.aspect})` : a.prompt;
        const data = await genericGenerate(page, spec, "image", prompt, onTick);
        return ok({ saved: [save(data, spec.id, a.prompt, a.output_path, a.overwrite)], via: spec.name });
      } finally {
        await page.close().catch(() => undefined);
      }
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
    job(extra, "quote", `${a.provider} quote`, async () => {
      if (a.provider === "higgsfield") {
        const model = a.model === "veo-lite" ? "seedance_2_0" : a.model;
        const credits = await higgsfieldCost(model, a.prompt ?? "test", { aspect_ratio: a.aspect });
        return ok({ provider: "higgsfield", model, credits, balance: (await higgsfieldStatus()).credits });
      }
      if (!FLOW_VIDEO.includes(a.model)) throw new Error(`Flow video models: ${FLOW_VIDEO.join(", ")}`);
      const page = await browser.page(extra.signal);
      try {
        const q = await flowQuote(page, { email: cfg.googleEmail, model: a.model as FlowModel, aspect: a.aspect, count: a.count as 1, project: readState(cfg).flowProject });
        writeState(cfg, { flowProject: q.project });
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
    return job(extra, a.provider, `${a.provider} video`, async (onTick) => {
      if (a.provider === "higgsfield") {
        if (a.max_credits < 1) throw new Error("Higgsfield videos spend credits. Call video_quote with provider higgsfield, tell the user, then pass max_credits.");
        const model = a.model === "veo-lite" ? "seedance_2_0" : a.model;
        const r = await higgsfieldGenerate(model, a.prompt, { aspect_ratio: a.aspect, duration: a.duration }, a.max_credits, extra.signal);
        return ok({ saved: [save(await downloadHttps(r.urls[0], extra.signal), "higgsfield", a.prompt, a.output_path, a.overwrite)], credits: r.credits, model });
      }
      const page = await browser.page(extra.signal);
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
          project: readState(cfg).flowProject,
          onTick,
        });
        writeState(cfg, { flowProject: r.project });
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
      "From one image, makes the sizes people need: Open Graph, LinkedIn, X, Instagram square/portrait/story, YouTube thumbnail, Pinterest, " +
      "GitHub social preview, favicon and app icons. fit: cover (fill and crop, photos), contain (whole image on a blurred copy of itself, logos and posters), " +
      "pad (whole image on a solid colour). Files go to the output folder named after each preset.",
    inputSchema: {
      input_path: z.string().max(500),
      presets: z.array(z.enum(Object.keys(SOCIAL_PRESETS) as [SocialPreset, ...SocialPreset[]])).optional().describe("Default: all"),
      fit: z.enum(["cover", "contain", "pad"]).default("contain"),
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
      const presets = a.presets ?? (Object.keys(SOCIAL_PRESETS) as SocialPreset[]);
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
      "Images to WebP, videos to H.264 with faststart. Raises quality until SSIM (similarity to the original) reaches the target, " +
      "so the size drops but the picture does not visibly change. The original is kept untouched. " +
      "Behaviour notice: by default the output has embedded metadata stripped (EXIF, XMP, C2PA content credentials, text chunks), " +
      "like most web image optimizers; the result lists what was removed. Pass keep_metadata: true to keep what re-encoding can carry. " +
      "Invisible watermarks such as SynthID are never touched.",
    inputSchema: {
      input_path: z.string().max(500),
      output_path: z.string().max(500).optional().describe("Default: same folder, .webp for images, -web.mp4 for videos"),
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
      const defOut = isVideo ? input.replace(/\.\w+$/, "-web.mp4") : input.replace(/\.\w+$/, ".webp");
      const out = resolveOutput({
        roots: cfg.outputRoots,
        outputPath: a.output_path ?? relative(root, defOut),
        provider: "optimize",
        prompt: "",
        ext: isVideo ? ".mp4" : ".webp",
        overwrite: a.overwrite,
      });
      mkdirSync(dirname(out), { recursive: true });
      const p = progress(extra, "optimize");
      try {
        const strip = a.keep_metadata ? false : cfg.stripAiMetadata;
        const r = isVideo
          ? await optimizeVideo(input, out, { maxWidth: a.max_width, keepAudio: a.keep_audio, strip })
          : await optimizeImage(input, out, a.max_width, undefined, strip);
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
