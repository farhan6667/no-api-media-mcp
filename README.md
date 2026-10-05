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

## Features

- **Images and videos from your own plans**: GPT Image (ChatGPT via Codex), Nano Banana and Veo 3.1 (Google Flow), Gemini, Higgsfield (Seedance, Kling and more), Grok
- **No API keys at all**: you sign in once, by hand, in a private Chrome window. API-key variables are stripped before any tool runs
- **Understands your project**: reads its colours, fonts, 3D or animation libraries and existing images, then matches the style (luxury, premium, playful, corporate, modest)
- **Designer-grade prompts**: three concept directions per asset with a critique checklist, so results aren't generic
- **Saves straight into your project**: full quality, no Download folder, no Save dialog, never outside the project
- **Shrinks for the web without visible loss**: WebP and H.264, checked with an SSIM quality score
- **Credit-safe**: shows the cost first, hard `max_credits` cap, one job at a time
- **Add any site with a small JSON file**, no code

## Quick start

```bash
git clone https://github.com/farhan6667/no-api-media-mcp
cd no-api-media-mcp
npm install && npm run build
node dist/src/index.js setup
```

`setup` checks your machine, opens a Chrome window where you sign in to ChatGPT and Google, and prints the line to add to your AI client. Then ask your agent:

> Use no-api-media to make a 16:9 hero image for this site with flow. Check the project's style first.

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

Requirements: **Node 22+**, **Google Chrome**, and **ffmpeg** for shrinking files.

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
| `design_brief` | Art direction: concept directions with ready prompts and a critique checklist |
| `image_generate` | Makes images with `codex`, `chatgpt`, `flow`, `gemini`, `higgsfield`, `grok` or your own site |
| `video_quote` | Exact credit cost for a Flow or Higgsfield job, generates nothing |
| `video_generate` | Veo 3.1 / Omni in Flow, Seedance / Kling in Higgsfield, or Grok, with a credit cap |
| `media_optimize` | Image to WebP, video to H.264, smaller with no visible change |

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
| `NOAPI_CHROME`, `NOAPI_FFMPEG`, `NOAPI_CODEX_JS`, `NOAPI_HIGGSFIELD` | auto-detected | Binary locations |

## Add another site without code

Put a file in `~/.no-api-media/providers/<id>.json`. Start from [`examples/providers/template.json`](examples/providers/template.json). Media is only downloaded from the hosts you list in `mediaHosts`, and specs are never read from a project folder.

## Safety and terms

- Your password never touches this code, there is no network port, and the server can't write outside your project. The full threat model is in [SECURITY.md](SECURITY.md).
- Web providers drive the consumer sites the way you would by hand. OpenAI's, Google's and xAI's terms restrict automated use of those sites, so **using them is your call and your account's risk**. The server works at human pace, stops at captchas and sign-in pages, and doesn't hide that it is automation. Official CLIs (Codex, Higgsfield) are the safer routes.

## Contributing

Fixes for broken selectors and new site specs are the most useful help. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
