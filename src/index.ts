#!/usr/bin/env node
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runSetup } from "./setup.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Browser } from "./browser.js";
import { loadConfig, readState, writeState } from "./config.js";
import { optimizeImage, optimizeVideo } from "./optimize.js";
import { chatgptImage, chatgptLastReply, chatgptStatus } from "./providers/chatgpt.js";
import { codexImage, codexStatus } from "./providers/codex.js";
import { genericGenerate, genericStatus, loadSpecs } from "./providers/generic.js";
import { downloadHttps, higgsfieldCost, higgsfieldGenerate, higgsfieldLogin, higgsfieldStatus } from "./providers/higgsfield.js";
import { flowGenerate, flowQuote, flowStatus, geminiImage, type Aspect, type FlowModel } from "./providers/google.js";
import { imageSize, isInside, JobGate, log, MEDIA_EXTS, redact, resolveOutput, sniff } from "./safety.js";
import { ASSET_TYPES, designBrief } from "./design.js";
import { projectProfile, TIERS } from "./project.js";

// Single source of truth for the version: package.json (two levels up from dist/src).
const VERSION: string = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"), "utf8")).version;
const cfg = loadConfig();
const browser = new Browser(cfg);

if (process.argv[2] === "setup" || process.argv[2] === "status") {
  // `status` is setup without opening the sign-in window.
  const args = process.argv.slice(3);
  await runSetup(cfg, browser, VERSION, process.argv[2] === "status" ? [...args, "--no-login"] : args);
  process.exit(0);
}
if (process.argv[2] === "login") {
  const services = (process.argv[3] ?? "chatgpt,google").split(",");
  await runSetup(cfg, browser, VERSION, ["--services", services.join(",")]);
  process.exit(0);
}
if (process.argv[2] === "help" || process.argv[2] === "--help") {
  process.stdout.write(
    `no-api-media-mcp ${VERSION}\n\n` +
      "  npx no-api-media-mcp setup            check everything, open the sign-in window, print client config\n" +
      "  npx no-api-media-mcp login [services] sign in again: login google, login chatgpt, or login chatgpt,google\n" +
      "  npx no-api-media-mcp status           show which accounts are ready, without opening a window\n" +
      "  npx no-api-media-mcp --version\n\n" +
      "Without a command it runs as an MCP server over stdio (that's what your AI client starts).\n",
  );
  process.exit(0);
}
if (process.argv[2] === "--version" || process.argv[2] === "-v") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
const gate = new JobGate(cfg.minGapSeconds * 1000);
const server = new McpServer({ name: "no-api-media-mcp", version: VERSION });
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
function job<T>(extra: Extra, key: string, label: string, fn: (onTick: (ms: number) => void) => Promise<T>) {
  const p = progress(extra, label);
  return gate
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
  return entry;
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
      "three genuinely different concept directions with ready prompts, a critique checklist to judge every result, and the iteration process. " +
      "Read the project's colours, fonts and existing art first and pass them in `brand`.",
    inputSchema: {
      asset_type: z.enum(ASSET_TYPES),
      subject: z.string().min(3).max(600).describe("What it should show or express, e.g. 'image and video generation without API keys'"),
      brand: z.object(brandShape).default({}),
      style: z
        .object({
          tier: z.enum(TIERS).optional().describe("From project_profile, or what the user asked for"),
          motion: z.enum(["3d", "animated", "static"]).optional(),
          theme: z.enum(["dark", "light", "unknown"]).optional(),
          referenceNotes: z.string().max(400).optional().describe("A few words on the project's existing images you looked at"),
        })
        .default({}),
    },
  },
  async (a) => ok(designBrief(a.asset_type, a.subject, a.brand, a.style)),
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

server.registerTool(
  "media_optimize",
  {
    title: "Shrink an image or video for the web without visible loss",
    description:
      "Images to WebP, videos to H.264 with faststart. Raises quality until SSIM (similarity to the original) reaches the target, " +
      "so the size drops but the picture does not visibly change. The original is kept untouched.",
    inputSchema: {
      input_path: z.string().max(500),
      output_path: z.string().max(500).optional().describe("Default: same folder, .webp for images, -web.mp4 for videos"),
      max_width: z.number().int().min(64).max(7680).optional(),
      keep_audio: z.boolean().default(false),
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
        const r = isVideo
          ? await optimizeVideo(input, out, { maxWidth: a.max_width, keepAudio: a.keep_audio })
          : await optimizeImage(input, out, a.max_width);
        return ok({ ...r, output: relative(root, r.output) });
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
