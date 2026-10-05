# Changelog

## 0.2.0 (2026-10-06)

A built-in, local media studio. Generation is unchanged.

- New tool `background_remove`: transparent cutouts with BiRefNet models through rembg (fast, best, portrait, anime). Runs on your machine, nothing is uploaded. Your system certificates are passed to rembg so the one-time model download works behind TLS-inspecting networks.
- New tool `video_edit`: trim, reframe (9:16, 1:1, 16:9, 4:5, 4:3 with crop or blurred fill), speed, fade, mute, replace audio, poster frame, GIF, text overlay, logo overlay, burned-in subtitles, join clips. Text and logo also work on images.
- New tool `social_sizes`: Open Graph, LinkedIn, X, Instagram square/portrait/story, YouTube, Pinterest, GitHub social preview, favicon and app icons from one image.
- New tool `media_probe`.
- design_brief: named looks (`neon-glass`, `neon-glass-light`, `luxury-gold`, `clay-3d`, `editorial-photo`).
- media_optimize keeps q98 WebP when it is within 0.01 SSIM of the target instead of falling back to a much larger lossless file.
- Local edits no longer wait the 20-second human-pace gap meant for websites.
- Security: user text reaches ffmpeg only through a file with expansion off, subtitles are copied under a fixed name, every input is checked to be inside the project and to really be media.

## 0.1.0 (2026-10-05)

- Server instructions: every MCP client receives the full workflow on connect, so users never write image prompts.
- Creative briefs written like a person briefing a designer (project, purpose, placement, premium quality bar) instead of keyword lists. New asset types: infographic and poster, with exact-text support.
- project_profile now reads what the project does from its README, package.json or site.
- Fixed: Chrome crashing on Flow downloads under automation (original-size media is fetched directly now).
- Fixed: downloads failing behind TLS-inspecting proxies or antivirus; the OS certificate store is trusted like in Chrome.
- Fixed: SSIM ignored hidden pixels under transparency, so transparent PNGs now compress properly.

First public version.

- Providers: Codex CLI (ChatGPT login), chatgpt.com, Google Flow (Nano Banana 2, Veo 3.1, Omni), Gemini, Higgsfield CLI (OAuth), Grok, and JSON-defined sites.
- Tools: `accounts_login`, `accounts_status`, `providers_list`, `image_generate`, `video_quote`, `video_generate`, `media_optimize`.
- Credit caps for Flow and Higgsfield, explicit confirmation for sites without a price.
- SSIM-checked WebP and H.264 optimisation.
- Security hardening from a pre-release audit: no shell or npm lookup in the project folder, API-key variables stripped from child CLIs, Codex forced to ChatGPT login with sandbox network off, media downloads limited to each provider's own hosts with checked redirects, Windows device names and alternate data streams rejected, wider redaction (Google cookies, OAuth tokens, home folders, display names), browser kept alive during long jobs, MCP progress and cancellation.
