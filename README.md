<p align="center"><img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/banner.webp" width="720" alt="no-api-media-mcp: your AI agent, connected through MCP, making images and videos"></p>

# no-api-media-mcp

[![ci](https://github.com/farhan6667/no-api-media-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/farhan6667/no-api-media-mcp/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Make images and videos from Claude Code (or any MCP client) with **the AI subscriptions you already pay for**: ChatGPT Plus/Pro, Google AI Pro/Ultra (Flow, Gemini), Higgsfield, Grok, and any other site you describe in a small JSON file.

**No API keys. No second bill. The server never sees your password.**

It saves full-quality files straight into your project, shrinks them for the web without a visible quality loss, and refuses to write anywhere outside the project.

## Why

ChatGPT Pro and Google AI Pro include a lot of image and video generation, but only inside their own apps. API access is a separate product with its own bill, and for a solo developer or a small team that bill adds up fast. This server bridges the gap: you sign in once, by hand, in a private Chrome profile, and your coding agent uses that session the way you would. Where a provider has an official CLI with account sign-in (Codex, Higgsfield), it uses that instead of a web page.

There is no API-key code path anywhere. API-key environment variables are actively stripped before any CLI is started, so a key you happen to have exported can never turn a generation into a paid API call.

## Tools

| Tool | What it does |
|---|---|
| `accounts_login` | Opens a normal Chrome window on the private profile so **you** sign in. For Higgsfield it starts the CLI's own OAuth sign-in. |
| `accounts_status` | Which accounts are ready, the Google plan tier, low-credit warnings, Higgsfield balance. |
| `providers_list` | Every built-in provider and every JSON site you added, with what each can make. |
| `project_profile` | Reads the project (read-only) to work out its personality: luxury, premium, playful, corporate, modest; 3D or animated; brand colours, fonts, existing images to match. |
| `design_brief` | Art direction before generating: concept directions with ready prompts, tuned to the project's personality, plus a critique checklist. |
| `image_generate` | One image (Flow and Higgsfield can return several). Providers: `codex`, `chatgpt`, `flow`, `gemini`, `higgsfield`, `grok`, or your own. |
| `video_quote` | Exact credit cost for a Flow or Higgsfield job. Generates nothing. |
| `video_generate` | Veo 3.1 / Omni in Flow, Seedance / Kling / Veo in Higgsfield, or Grok. Hard `max_credits` cap. |
| `media_optimize` | Image to WebP, video to H.264 + faststart. Raises quality until SSIM against the original is at least 0.985 (images) or 0.97 (video). |

Long jobs send MCP progress notifications and stop when the client cancels.

### Providers

| id | Makes | How it signs in | Notes |
|---|---|---|---|
| `codex` | images | Codex CLI, `codex login` with ChatGPT | Most reliable ChatGPT route. Image turns use your Codex limit faster than chat. |
| `chatgpt` | images | chatgpt.com in the private profile | Lands in your ChatGPT history. Cloudflare may ask for a human check; then use `codex`. |
| `flow` | images, videos | Google, in the private profile | Nano Banana 2 images were 0 credits on AI Pro when tested. Videos cost Flow credits. |
| `gemini` | images | Google, in the private profile | |
| `higgsfield` | images, videos | official CLI, `higgsfield auth login` (OAuth) | 40+ models. Exact cost from the CLI before every job. |
| `grok` | images, videos | grok.com in the private profile | JSON spec, limits depend on your plan. |
| yours | images, videos | the site, in the private profile | See [Adding another site](#adding-another-site-without-code). |

## Install

Requirements: Node 22+, Google Chrome, and ffmpeg for `media_optimize`. Optional: `npm i -g @openai/codex` and `npm i -g @higgsfield/cli` for those providers.

```bash
git clone https://github.com/farhan6667/no-api-media-mcp
cd no-api-media-mcp
npm install
npm run build
```

Add it to Claude Code (user scope, so every project gets it):

```bash
claude mcp add --scope user no-api-media -- npx -y no-api-media-mcp@latest
```

Then, in any project, ask Claude to run `accounts_login`, sign in yourself in the window that opens, and close it. That's the only time you sign in.

## Connect your accounts (one time)

You sign in yourself, once, in a private Chrome window. The server never asks for or sees a password, and nothing goes into a config file.

**Easiest: run setup**

```bash
npx -y no-api-media-mcp@latest setup
```

It checks Node, Chrome, ffmpeg, Codex and Higgsfield, opens a Chrome window with ChatGPT and Google sign-in, waits until you close it, then shows what's ready and prints the config for your MCP client.

**Or ask your agent.** Once the server is added to your client, just say *"run accounts_login"*. The same window opens.

| Account | What you need | How to connect | What "ready" looks like in `accounts_status` |
|---|---|---|---|
| Google AI Pro / Ultra (Flow, Gemini) | A Google account with the plan | Sign in at the Google tab in the window. With several Google accounts, use the one that has the plan, or set `NOAPI_GOOGLE_EMAIL` | `google: signed in, PRO, j***@gmail.com` |
| ChatGPT (images) | ChatGPT Plus or Pro | Best: `npm i -g @openai/codex`, then `codex login` and choose ChatGPT. Also possible: sign in at the chatgpt.com tab | `codex: signed in with ChatGPT` |
| Higgsfield | A Higgsfield plan | `npm i -g @higgsfield/cli`, `higgsfield auth login`, then once `higgsfield workspace set <id>` | `higgsfield: signed in` |
| Grok or any JSON site | That site's plan | `accounts_login` with the site id, e.g. `grok` | `grok: signed in` |

Close the whole window when you're done. The server can't use the profile while that window is open.

The private profile lives in `~/.no-api-media/chrome-profile` (on Windows `C:\Users\<you>\.no-api-media\chrome-profile`). Delete that folder to sign out of everything.

## Your first prompt

Type something like this in Claude Code, Cursor or any MCP client:

> Use no-api-media to make a 16:9 hero image for this site with flow. Check the project's style first.

The agent calls `project_profile` (your site's colours, fonts, 3D or animation libraries, existing images), `design_brief` (art direction with several concepts), `image_generate`, looks at the results, and saves the best one in your project. Then:

> Shrink it for the web and put it in public/images.

That's `media_optimize`.

## Where files go

- Without `output_path`: `<project>/.ai-media/<provider>/<date>-<prompt-slug>.<ext>`. That folder ignores itself in git and keeps a `manifest.jsonl` of every prompt and file.
- With `output_path` (for example `public/images/hero.png`): must be inside the project and must be a media extension. Anything else is refused **before** quota is spent.
- Nothing ever goes to `~/Downloads`, and there is no Save dialog.

A good loop for an agent: generate into `.ai-media`, look at the result, regenerate with a corrected prompt if something is off, then `media_optimize` the keeper into `public/`.

## Adding another site without code

Drop a file in `~/.no-api-media/providers/<id>.json`. Start from [`examples/providers/template.json`](examples/providers/template.json):

```json
{
  "id": "my-site",
  "name": "My image site",
  "url": "https://example.com/create",
  "kinds": ["image"],
  "input": "textarea",
  "submit": "enter",
  "promptTemplate": { "image": "Generate an image: {prompt}" },
  "busy": "button[aria-label*='Stop']",
  "loggedOut": "a[href*='login']",
  "mediaHosts": ["example.com", "examplecdn.com"]
}
```

The server waits for a new image or video at least `minSize` pixels wide, then downloads it, but only from `mediaHosts` (default: the site's own domain). Specs are read only from your home folder, never from a project, and must use https.

## Configuration (all optional)

| Variable | Default | Meaning |
|---|---|---|
| `NOAPI_HOME` | `~/.no-api-media` | Private profile and state. Keep it out of any repo. |
| `NOAPI_OUTPUT_ROOTS` | the folder the client starts the server in | Folders the server may write to, `;` separated on Windows, `:` elsewhere. |
| `NOAPI_GOOGLE_EMAIL` | first signed-in account | Which Google account to use when several are signed in. Matched on the page, never sent in a URL. |
| `NOAPI_MIN_GAP` | `20` | Seconds between two generations on one provider. |
| `NOAPI_CHROME`, `NOAPI_FFMPEG`, `NOAPI_CODEX_JS`, `NOAPI_HIGGSFIELD` | auto-detected | Override binary locations. |

## Keeping your accounts safe

Your password never touches this code, your session never leaves your machine, and the server can't be pointed at the rest of your disk. The threat model, every mitigation and the tests behind them are in [SECURITY.md](SECURITY.md).

## Please read: terms and limits

- Web providers drive the consumer apps the way you would by hand. OpenAI's, Google's and xAI's terms restrict automated use of those apps. **Using it is your call and your account's risk.** The server works at human pace (one job at a time, a gap between jobs), stops at captchas and sign-in walls, and does not hide that it is automation (Chrome shows its usual "controlled by automated software" bar).
- Your plan's limits still apply.
- Web pages change. When a selector breaks, the tool says so instead of guessing. Fixes are very welcome, see [CONTRIBUTING.md](CONTRIBUTING.md).
- A display is required: Chrome runs visibly. On a Linux server use Xvfb.
- Only one copy of the server can use the profile at a time.

## Development

```bash
npm test                                   # unit + security tests
node scripts/smoke.mjs <dir> status        # talks to the real server over stdio
node scripts/smoke.mjs <dir> img:flow "optimize:.ai-media/flow/x.png"
```

## License

MIT
