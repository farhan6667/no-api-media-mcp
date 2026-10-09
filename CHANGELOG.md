# Changelog

## 0.5.0 (2026-10-10)

- **Learns from its own mistakes.** `design_audit` (with `asset_type`) writes each score sheet to a small local journal. `design_brief` reads it back, and any criterion that fell short at least twice for that asset type becomes advice at the end of every prompt. Nothing is uploaded.
- **Built-in lessons from real use** (`docs/lessons.md`): 14 short rules, such as never letting the model draw logos or text, keeping the subject centred with margins, and putting a black-background logo on a dark glass plate. The brief adds the ones that fit the asset type and keeps every prompt under the 4000 character limit.
- **`context.targetAspect`** in `design_brief`: a very wide final crop (for example `3.2:1`) adds guidance to keep the important parts in the middle band.
- **Draft housekeeping.** Each draft has a status (draft, shortlisted, rejected, used). `design_audit` with `file` marks drafts, and `media_optimize` marks the source as used. Old drafts in `.ai-media` are removed on their own once per session: rejected after 3 days, used (and only if the final file still exists) after 14, untouched after 30. New tool `media_cleanup` (dry run by default). Turn the automatic part off with `config set auto_cleanup false` or `NOAPI_AUTO_CLEANUP=0`. It only touches media files inside `.ai-media`.
- **Fix: newer Codex CLI.** Codex now keeps the picture in its own `generated_images` folder and refuses to copy it into the sandbox, which made every Codex generation fail. The server now takes the newest image Codex wrote after the run started, from that folder only.
- Server instructions now tell the model to pass `asset_type` and `file` to the audit, set `targetAspect`, composite real logos and text itself, and put the final file in the project's own images folder.
- Tests: 126 pass.


## 0.4.0 (2026-10-09)

- New tool `design_audit`: an eight-point eye-catch audit (focal point, thumbnail test, hierarchy, palette, topic cues, brand presence, text accuracy, not template). Ship needs an average of 4 and nothing below 3; missing scores never count as a pass.
- `design_brief` now returns the audit criteria, field-specific visual cues (for example a shield, hex grid and terminal for cyber security) and a third-party rule: never draw another company's logo, show the topic through colour and motif and add an independent-project note.
- Server instructions: exact words, commands and numbers are drawn locally as SVG or HTML instead of asked from an image model; real brand logos are placed from the project's files after generation.

## Unreleased

- Licence changed from MIT to Apache-2.0 for future versions (adds an explicit patent grant and a NOTICE file). Versions already published stay under MIT.

## 0.3.0 (2026-10-06)

**Behaviour change.** `media_optimize` now strips embedded metadata from the files it writes, by default, and says so.

- Images: PNG `caBX` (C2PA), `iTXt`/`tEXt`/`zTXt`, `eXIf`; JPEG APP1 (EXIF/XMP), APP11 (JUMBF/C2PA), APP13 (Photoshop/IPTC), COM; WebP `EXIF`, `XMP`, `C2PA` chunks with the VP8X flags corrected. Pixels, colour profile and dimensions are untouched.
- Videos: `-map_metadata -1 -map_chapters -1`, then the output is inspected for a C2PA `uuid` box; if one survives it is trimmed (when it trails the media data) or the container is re-muxed.
- Every result carries a `metadata` block: `stripped`, `removed`, `kept`, and a note when something could not be removed or when stripping was off.
- Off switches: `keep_metadata: true` per call, `NO_API_MEDIA_KEEP_METADATA=1`, or `config set strip_ai_metadata false` (new `config` CLI command). Precedence: call, environment, config file, default.
- One-time notice after upgrading: in the first `media_optimize` result and in `setup` / `status`.
- Note: 0.2 already dropped this metadata silently as a side effect of re-encoding to WebP/H.264. Nothing here touches invisible watermarks such as SynthID, and the README says so plainly.

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
