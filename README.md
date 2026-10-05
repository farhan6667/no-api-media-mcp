<div align="center">

<img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/banner.webp" width="640" alt="no-api-media-mcp logo">

[![ci](https://github.com/farhan6667/no-api-media-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/farhan6667/no-api-media-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
![Node 22+](https://img.shields.io/badge/node-22%2B-339933?logo=node.js&logoColor=white)
<br>
![MCP compatible](https://img.shields.io/badge/MCP-compatible-6E56CF)
![Claude Code ready](https://img.shields.io/badge/Claude%20Code-ready-D97757)
![No API key](https://img.shields.io/badge/API%20key-not%20needed-14B8A6)

**MCP server that makes images and videos for your projects with the AI subscriptions you already pay for.**<br>
**No API keys. No second bill.** Uses your own ChatGPT, Google AI Pro, Higgsfield and Grok accounts.

[Features](#features) • [Quick start](#quick-start) • [Connect accounts](#connect-your-accounts) • [Installation](#installation) • [Tools](#tools) • [CLI commands](#cli-commands) • [Troubleshooting](#troubleshooting)

</div>

---

<p align="center"><img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/workflow.webp" width="100%" alt="Overview: your AI client (Claude Code, Cursor, Windsurf) talks to the no-api-media-mcp server, which uses your AI subscriptions (ChatGPT, Google AI Pro / Flow, Gemini, Higgsfield, Grok) and saves generated images and videos in your project. Features: project-aware generation, images and videos, designer-grade prompts, auto save to project, credit limits, flexible providers"></p>

## Behaviour notice: metadata is stripped from optimized files

Since 0.3.0, `media_optimize` removes embedded metadata from the files it writes: EXIF, XMP, text chunks and **C2PA content credentials** (the signed manifest that ChatGPT, Codex, Google Flow, Gemini and Veo embed, and that platforms such as LinkedIn turn into a "Content credentials" badge). This is what most web image optimizers and CDNs do, and in fact 0.2 already dropped it as a silent side effect of re-encoding. 0.3 makes it explicit: every result lists what was removed, and you can turn it off.

- **Your originals are never touched.** Generated files in `.ai-media/` keep their manifests; only the optimized copy is stripped.
- **Turn it off** in any of three ways: `keep_metadata: true` on a call, the environment variable `NO_API_MEDIA_KEEP_METADATA=1`, or `node dist/src/index.js config set strip_ai_metadata false`.
- **What it does not do.** This removes embedded *metadata* only. It does **not** remove invisible watermarks such as Google SynthID, which live in the pixels, so platforms and detectors may still identify the AI origin. It is not a way to pass AI images off as real photographs. You are responsible for the rules of the platforms you post to and for any disclosure requirements that apply to you.
- A signed C2PA manifest cannot survive re-encoding anyway (it is bound to the original bytes), so with `keep_metadata: true` the result is honest about what the encoder lost rather than copying an invalid manifest.

## Features

- **Images and videos from your own plans**: GPT Image (ChatGPT via Codex), Nano Banana and Veo 3.1 (Google Flow), Gemini, Higgsfield (Seedance, Kling and more), Grok
- **No API keys at all**: you sign in once, by hand, in a private Chrome window. API-key variables are stripped before any tool runs
- **Understands your project**: reads what it does, its colours, fonts, 3D or animation libraries and existing images, then matches the style (luxury, premium, playful, corporate, modest)
- **Premium by default**: writes a real creative brief for every asset, with named looks like `neon-glass` (the style of the graphics on this page)
- **Built-in media studio** *(new in 0.2)*: background removal, video editing for Reels and Shorts, and every social size from one image, all running locally
- **Saves straight into your project**: full quality, no Download folder, no Save dialog, never outside the project
- **Shrinks for the web without visible loss**: WebP and H.264, checked with an SSIM quality score
- **Credit-safe**: shows the cost first, hard `max_credits` cap, one job at a time
- **Add any site with a small JSON file**, no code

## What's new in 0.2

<p align="center"><img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/whats-new-0.2.webp" width="100%" alt="What's new in 0.2: background removal, video editing (trim, reframe 9:16, subtitles, GIF) and social sizes (Instagram, LinkedIn, YouTube, Story). Runs locally, no API keys. Made with this MCP"></p>

<sub>This image was made by no-api-media-mcp itself: `design_brief` with the `neon-glass` look, generated in Google Flow on an AI Pro plan, 0 credits.</sub>

| Tool | What it does |
|---|---|
| `background_remove` | Cuts out the subject into a transparent PNG with BiRefNet models via [rembg](https://github.com/danielgatis/rembg). Fully local, nothing uploaded. Quality: `fast`, `best`, `portrait`, `anime` |
| `video_edit` | Trim, reframe to 9:16 / 1:1 / 16:9 / 4:5, speed, fade, mute, replace audio, poster frame, GIF, text overlay, logo, burned-in subtitles, join clips |
| `social_sizes` | One image into Open Graph, LinkedIn, X, Instagram square/portrait/story, YouTube thumbnail, Pinterest, GitHub social preview, favicon and app icons. Cover, blurred-fill or solid padding |
| `media_probe` | Duration, size, frame rate and codecs of any file |

Try:

```text
Remove the background from public/products/lamp.jpg.
Turn this 16:9 clip into a 9:16 Reel with our logo top-right and these subtitles.
Make every social size from public/og.png.
```

## Quick start

```bash
git clone https://github.com/farhan6667/no-api-media-mcp
cd no-api-media-mcp
npm install && npm run build
node dist/src/index.js setup
```

`setup` checks your machine, opens a Chrome window where you sign in to ChatGPT and Google, and prints the line to add to your AI client. Then just ask your agent for what you need.

## No prompt writing needed

<p align="center"><img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/how-it-works.svg" width="900" alt="You ask your AI agent, the MCP reads your project, writes the art direction, generates with your plan, checks the result and saves it into your project"></p>

You don't write image prompts. When your AI client connects, this server hands it a full workflow, and the agent follows it on its own:

1. **Reads your project**: what it does (from the README or site), colours, fonts, 3D or animation libraries, existing images
2. **Writes a real creative brief**: what the project is, where the image goes, who sees it, what it must achieve, and a premium quality bar. This is the part that makes results look high-end instead of generic
3. **Generates** with the right tool: GPT Image (ChatGPT) for designs with text, Google Flow for photo and 3D scenes
4. **Checks every result** against a design checklist (spelling, brand fit, no third-party logos, crop) and retries with a corrected brief
5. **Shrinks and places** the winner in your project, with real alt text

### Try one of these

Copy any of these into Claude Code, Cursor or Codex, inside your project:

```text
Look at this project and tell me where images or video would make the site better, then make them and put them in.
```

```text
Make a premium 16:9 hero image for the landing page that matches our brand.
```

```text
Create a 1200x630 social preview image for this repo, with the project name spelled exactly.
```

```text
Make a premium infographic that explains what this project does, for the top of the README.
```

```text
Make an 8 second calm background video for the hero, quote the credits first.
```

That's the whole interface. Say "premium", "luxury", "minimal" or "playful" if you want a specific level, otherwise it aims for premium.

### Made with this MCP

Both of these came out of the prompts above, through Google Flow on an AI Pro plan, 0 credits, no API key:

<p align="center">
<img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/example-infographic.webp" width="49%" alt="Infographic generated by no-api-media-mcp: your AI client, the MCP server and your AI subscriptions, with the media saved in your project">
<img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/example-hero.webp" width="49%" alt="Hero image generated by no-api-media-mcp: a developer at night with glowing images and video frames floating from the laptop">
</p>

### At a glance

<p align="center">
<img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/product-overview.webp" width="49%" alt="Product overview: generate images and videos using the AI accounts you already have, works with ChatGPT via Codex, Google Flow, Gemini, Higgsfield and Grok, and how it works from your AI client to files in your project">
<img src="https://raw.githubusercontent.com/farhan6667/no-api-media-mcp/main/docs/img/poster.webp" width="42%" alt="Make images and videos with the AI plan you already pay for. No API keys, no second bill. Works in Claude Code, Cursor, Codex and any MCP client">
</p>

## Connect your accounts

You sign in yourself, once. The server never asks for or sees a password.

| Account | You need | How to connect | Ready when `status` shows |
|---|---|---|---|
| **Google AI Pro / Ultra** (Flow, Gemini) | A Google account with the plan | Sign in at the Google tab in the setup window | `google  signed in, PRO, j***@gmail.com` |
| **ChatGPT** (images) | ChatGPT Plus or Pro | `npm i -g @openai/codex` then `codex login`, choose ChatGPT | `Codex CLI  ok, signed in with ChatGPT` |
| **Higgsfield** | A Higgsfield plan | `npm i -g @higgsfield/cli`, `higgsfield auth login`, then `higgsfield workspace set <id>` | `Higgsfield CLI  ok, signed in` |
| **Grok** or any JSON site | That site's plan | Ask your agent to run `accounts_login` with `grok` | `grok  signed in` |

> Close the whole setup window when you're done. The server can't use the private profile while it is open.

## Installation

Requirements: **Node 22+**, **Google Chrome**, and **ffmpeg** for shrinking and editing. Optional: **rembg** for background removal (`uv tool install "rembg[cpu,cli]"` or `pip install "rembg[cpu,cli]"`; the model downloads once on first use).

<details open>
<summary><b>Claude Code</b></summary>

```bash
# all projects
claude mcp add --scope user no-api-media -- node /full/path/to/no-api-media-mcp/dist/src/index.js

# this project only
claude mcp add no-api-media -- node /full/path/to/no-api-media-mcp/dist/src/index.js
```
</details>

<details>
<summary><b>Claude Desktop / Cursor / Windsurf</b></summary>

Add to your MCP config:

```json
{
  "mcpServers": {
    "no-api-media": {
      "command": "node",
      "args": ["/full/path/to/no-api-media-mcp/dist/src/index.js"]
    }
  }
}
```

Config file locations:

| App | File |
|---|---|
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` or `.cursor/mcp.json` in the project |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

Restart the app after editing.
</details>

<details>
<summary><b>VS Code</b></summary>

`.vscode/mcp.json`:

```json
{
  "servers": {
    "no-api-media": { "command": "node", "args": ["/full/path/to/no-api-media-mcp/dist/src/index.js"] }
  }
}
```
</details>

<details>
<summary><b>Codex CLI</b></summary>

```bash
codex mcp add no-api-media -- node /full/path/to/no-api-media-mcp/dist/src/index.js
```
</details>

## Tools

| Tool | What it does |
|---|---|
| `accounts_login` | Opens the private Chrome window so **you** sign in |
| `accounts_status` | Which accounts are ready, plan tier, low-credit warnings |
| `providers_list` | Every provider and JSON site, and what each can make |
| `project_profile` | Reads the project: style tier, 3D/animated, colours, fonts, reference images |
| `design_brief` | Writes a real creative brief (project, purpose, placement, premium quality bar) with concept directions and a critique checklist. Asset types: logo, app icon, hero, illustration, product shot, social post, banner, infographic, poster, background video, product video |
| `image_generate` | Makes images with `codex`, `chatgpt`, `flow`, `gemini`, `higgsfield`, `grok` or your own site |
| `video_quote` | Exact credit cost for a Flow or Higgsfield job, generates nothing |
| `video_generate` | Veo 3.1 / Omni in Flow, Seedance / Kling in Higgsfield, or Grok, with a credit cap |
| `media_optimize` | Image to WebP, video to H.264, smaller with no visible change. Strips embedded metadata by default and reports it (see the behaviour notice); `keep_metadata: true` to keep |
| `background_remove` | Transparent cutout, local BiRefNet models via rembg |
| `video_edit` | Trim, reframe, speed, fade, mute, audio, poster frame, GIF, text, logo, subtitles, join |
| `social_sizes` | Every social and icon size from one image |
| `media_probe` | Duration, size, fps, codecs |

<details>
<summary><b>Providers in detail</b></summary>

| id | Makes | Signs in with | Notes |
|---|---|---|---|
| `codex` | images | Codex CLI, ChatGPT login | Most reliable ChatGPT route |
| `chatgpt` | images | chatgpt.com in the private profile | Cloudflare may ask for a human check; use `codex` then |
| `flow` | images, videos | Google, in the private profile | Nano Banana 2 images were 0 credits on AI Pro when tested; videos cost credits |
| `gemini` | images | Google, in the private profile | |
| `higgsfield` | images, videos | official CLI (OAuth) | Exact cost shown before every job |
| `grok` | images, videos | grok.com in the private profile | Limits depend on your plan |
</details>

## Where files go

- No `output_path`: `<project>/.ai-media/<provider>/<date>-<prompt>.<ext>`, ignored by git, with a `manifest.jsonl` of every prompt
- With `output_path` (e.g. `public/images/hero.png`): must be inside the project and a media file, checked before anything is generated

## CLI commands

| Command | What it does |
|---|---|
| `node dist/src/index.js setup` | Check everything, open the sign-in window, print client config |
| `node dist/src/index.js login google` | Sign in to one service again (`google`, `chatgpt`, or `chatgpt,google`) |
| `node dist/src/index.js status` | Show which accounts are ready, without opening a window |
| `node dist/src/index.js --version` | Print the version |
| `node dist/src/index.js config` | Show `strip_ai_metadata` and where its value comes from |
| `node dist/src/index.js config set strip_ai_metadata false` | Keep embedded metadata in optimized files (`true` to strip again) |
| `node dist/src/index.js help` | List these commands |
| `codex login status` | Check the Codex CLI is signed in with ChatGPT |
| `higgsfield workspace list` | List Higgsfield workspaces to pick one |
| `npm test` | Run the test suite (unit and security tests) |

Without a command, `dist/src/index.js` runs as the MCP server. That's what your AI client starts.

## Troubleshooting

| You see | Do this |
|---|---|
| `profile is already open` | The sign-in window (or another copy of the server) is still open. Close that Chrome window and try again |
| `Not signed in. Run accounts_login` | Run `login google` or `login chatgpt` and sign in in the window |
| `chatgpt.com is asking for a human check` | ChatGPT's Cloudflare noticed automation. The server never solves these. Use `codex` for ChatGPT images, or `flow` |
| `Codex must be signed in with ChatGPT (not an API key)` | Run `codex login` and choose **Sign in with ChatGPT** |
| `Codex limit is used up` | Your plan's Codex quota is spent. Use `flow` or wait for the reset |
| `Pick a Higgsfield workspace once` | `higgsfield workspace list`, then `higgsfield workspace set <id>` |
| `That Google account is not signed in` | Sign in with the account that has your AI plan, or set `NOAPI_GOOGLE_EMAIL` to it |
| `Flow no longer offers "..."` or a menu not found | Google changed the Flow page. Update to the latest version or [open an issue](https://github.com/farhan6667/no-api-media-mcp/issues) |
| `running low on Google Flow credits` | Video credits are low. Images on Nano Banana 2 usually still work |
| `Google Chrome not found` | Install Chrome or set `NOAPI_CHROME` to its path |
| `ffmpeg not found` | `winget install Gyan.FFmpeg` (Windows), `brew install ffmpeg` (macOS), `sudo apt install ffmpeg` (Linux) |
| `Background removal needs rembg` | `uv tool install "rembg[cpu,cli]"` or `pip install "rembg[cpu,cli]"` |
| `rembg is installed without a backend` | `uv tool install --force "rembg[cpu,cli]"` |
| `certificate check` while downloading a model | Your network inspects TLS. The server passes your system certificates to rembg automatically; if it still fails, run once on another network, the model is cached afterwards |
| `Refusing to write outside the allowed folders` | Use a path inside the project, like `public/images/hero.png` |
| Nothing happens on a Linux server | Chrome needs a display. Run under Xvfb |

## Configuration

All optional.

| Variable | Default | Meaning |
|---|---|---|
| `NOAPI_HOME` | `~/.no-api-media` | Private profile and state. Delete it to sign out of everything |
| `NOAPI_OUTPUT_ROOTS` | the folder the client starts the server in | Folders the server may write to |
| `NOAPI_GOOGLE_EMAIL` | first signed-in account | Which Google account to use |
| `NOAPI_MIN_GAP` | `20` | Seconds between two generations on one provider |
| `NO_API_MEDIA_KEEP_METADATA` | unset | `1` keeps embedded metadata in `media_optimize` output. Same as `strip_ai_metadata=false` in `config.json`; the environment wins |
| `NOAPI_CHROME`, `NOAPI_FFMPEG`, `NOAPI_CODEX_JS`, `NOAPI_HIGGSFIELD`, `NOAPI_REMBG` | auto-detected | Binary locations |

## Add another site without code

Put a file in `~/.no-api-media/providers/<id>.json`. Start from [`examples/providers/template.json`](examples/providers/template.json). Media is only downloaded from the hosts you list in `mediaHosts`, and specs are never read from a project folder.

## Safety and terms

- Your password never touches this code, there is no network port, and the server can't write outside your project. The full threat model is in [SECURITY.md](SECURITY.md).
- Web providers drive the consumer sites the way you would by hand. OpenAI's, Google's and xAI's terms restrict automated use of those sites, so **using them is your call and your account's risk**. The server works at human pace, stops at captchas and sign-in pages, and doesn't hide that it is automation. Official CLIs (Codex, Higgsfield) are the safer routes.

## Contributing

Fixes for broken selectors and new site specs are the most useful help. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

---

<div align="center">

Built by <a href="https://github.com/farhan6667">Syed Farhan Ahmed</a> · <a href="https://nexaforge.eu.cc/">nexaforge.eu.cc</a> · <a href="https://www.linkedin.com/in/sfa6667">LinkedIn</a> · <a href="https://farhan6667.github.io/portfolio/">Portfolio</a>

</div>
