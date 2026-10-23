# Changelog

## 1.4.1 (2026-10-24)

A security and correctness release from an adversarial QA pass. Every fix below was reproduced first against
1.4.0 with a real crafted input, and each one has a regression test in `test/adversarial.test.ts`.

**Security**

- **A planted `.ai-media` link could make cleanup delete your files elsewhere.** If a cloned repo shipped
  `.ai-media` as a symbolic link or junction, `media_cleanup` followed it and removed old media files in the
  folder it pointed to (reproduced on Windows with a junction: a 60 day old photo outside the project was
  deleted). `.ai-media` now has to be a real folder inside the project; otherwise nothing is read, written or
  deleted through it, and generation stops before spending quota.
- **`project_profile` followed links out of the project.** Its scan used `stat`, which follows links, so a
  junction to another folder was read as part of the project, and a README.md linked to a credentials file
  would have come back as the project's "about" text (which the workflow then puts into prompts sent to a
  provider). It now walks with `lstat`, skips every link and only reads regular files inside the project.
- **The printed client config could run someone else's package.** `setup` printed
  `npx -y no-api-media-mcp@latest` and the help text used `npx no-api-media-mcp`, but the name is not
  published on npm, so anyone could publish under it and that code would run on every server start. The
  config now always starts this copy by its full path with `node`. The update notice tells a git checkout to
  `git pull`, `npm ci` and `npm run build`, and suggests npm only to npm installs.
- **Auto-update hardened.** It now runs only for an npm install, only with a plain version number from the
  GitHub release (a tag like `9.9.9#github:someone/repo` or `file:../x` is ignored), through npm's own script
  run by Node from the temp folder. On Windows it used to fail outright, since Node refuses to spawn `npm.cmd`
  without a shell. A test used to run a real `npm install -g` of an unpublished name on every CI run; the tests
  now never reach the npm registry.
- **Network paths are refused before the disk is touched.** An `input_path` like `\\host\share\x.png` reached
  the filesystem before the project check, which on Windows makes the machine offer the user's NTLM
  credentials to that host. Input paths are now checked on their text first, then again after links are
  resolved. Inputs outside the project get the same error whether or not the file exists, so errors no longer
  tell a caller what exists elsewhere on the disk.
- **Links that point nowhere are no longer written through.** A dangling symbolic link or junction inside the
  project passed the output check (it doesn't "exist"), and a write would create the file wherever it pointed.
  It is now refused with a clear message.
- **Brand logos must be real local images.** `brand_profiles` accepted any path, including network paths and
  text files. A logo now has to be a PNG, JPEG, WebP or GIF under 8 MB on this computer, checked when it is
  registered and again when `compose` uses it.

**Fixes**

- `media_cleanup` called with its defaults removed nothing: the tool passed `undefined` for each day count and
  that switched every rule off. The documented defaults (3, 14, 30 and 60 days) now apply.
- A damaged `~/.no-api-media/state.json` crashed the server at startup. It now reads as empty.
- A missing Chrome stopped the whole server at startup, even for Codex, Higgsfield and the local media tools.
  Only the tools that need the browser now report it.
- Higgsfield downloads always have a 10 minute deadline, even when the client passes its own cancel signal.
- An empty `input_path` or a folder now gets a plain message instead of `EISDIR`.

**Supply chain and CI**

- Direct dependencies pinned to exact versions. `npm audit fix` moved body-parser to 2.4.0 and ip-address to
  10.7.4 (both only used by the MCP SDK's HTTP transport, which this stdio server doesn't start), and fast-uri to
  3.1.9 (used by the SDK's JSON schema checks). body-parser 2.4.0 and fast-uri 3.1.9 were checked for npm
  provenance before taking them.
- GitHub Actions pinned to commit SHAs, CI also runs `npm audit signatures`, and the npm publish workflow only
  grants the OIDC token to its one job.
- The quick start uses `npm ci`, which installs exactly what `package-lock.json` says.

**Docs**

- README and SECURITY.md no longer say there is "no network port" or that the browser is driven only over a
  pipe while `share_browser` (on by default) opens a loopback devtools port. Stale lines fixed: the idle
  timeout is 20 minutes, a second session queues or shares instead of failing, and the update check and
  Google Fonts requests are now listed under telemetry.
- Every `no-api-media-mcp config ...` command became `node dist/src/index.js config ...`, since the bare
  command only exists for an npm install.

## 1.4.0 (2026-10-21)

- **New: `reference_images` on `image_generate`.** Give Codex up to four photos from your project to keep a face,
  a product or an approved look consistent while you change the clothes, setting, light or expression. Each one
  must be a real image inside the project. It was checked live: the same face came back in a new scene, and a
  second pass changed only the expression.
- **Fix: picking the Flow video model.** The menu item's name came with an icon line in front of it, so the
  full label never matched and the click could miss. It now matches the model name on its own line.
  Image generation through Flow was checked live (0 credits). The video menu was not run, because it costs
  credits, so tell me if a Veo model does not get picked.
- Dependencies: zod 4.6.7, playwright-core 1.64.1, @types/node 26.6.5.
- The README has a Support button.

## 1.3.0 (2026-10-11)

- **The README graphics are rebuilt for 1.x.** The overview, the "What's new" image, the poster and the
  how-it-works sheet now show the current features: compose, deliver, measured audits, corrections that
  stick, several sessions at once.
- **No other company's logo on any of them.** The earlier graphics had image-model-drawn marks for the
  providers and editors this works with. Those are trademarks and don't belong in the project's own
  images; every name is now plain text, and the only marks are the project's own, NexaForge's and SFA's.
- Made the way the server now recommends, as a check of its own advice: background art from
  `design_brief` and `image_generate`, all words and logos set in HTML on top, then `composition_check`
  (all four clean) and `media_optimize` (about 80% smaller at SSIM 0.985 or better).
- No code changes since 1.2.0.


## 1.2.0 (2026-10-11)

- **The browser closes when the work is done, not before.** New `browser_done` tool: the assistant calls
  it at the very end, once the final asset is in the project, checked, and you have nothing left to
  change. It closes this session's browser right then instead of leaving the window open. The server's
  instructions tell clients never to call it between rounds of edits.
- **It never closes on another session.** With browser sharing on, a session that finishes leaves the
  browser open while other sessions still have tabs in it, and the last one to finish closes it. Checked
  live with two processes: the first session finished mid-way through the second one's job, the second
  job carried on, and the browser closed on its own afterwards.
- **A safety net, now set by you.** If `browser_done` is never called, the browser closes after
  `browser_idle_minutes` idle (default 20, `0` turns the safety net off):
  `no-api-media-mcp config set browser_idle_minutes 10`.
- The tab Chrome opens on launch now shows a short note saying why the window is open, instead of a blank
  page. It stays, because Chrome quits when its last tab closes, which would otherwise restart the browser
  between every round of edits.
- README FAQ: which assistant model to use (the images come from your provider; your assistant's model
  matters for briefing and judging), and which apps or extensions you need, with links.

Tests: 262 pass, plus live runs: three rounds of edits in one browser, closed on browser_done, and the
two-session case above.


## 1.1.0 (2026-10-11)

This release comes out of two independent audits of the server (run on different models, read-only) and
a real mistake: a LinkedIn post image that shipped with an empty navy band across the top, a plain white
glowing headline in a corner, and the company logo where the person's own mark belonged. Every root cause
the audits found is fixed, and the fixes are measured rather than left as advice.

**It stops asking the model for the wrong things**
- Prompts no longer ask for empty space unless real text is going there: `context.overlayText` says what
  you'll set on top, and the brief leaves one calm zone sized for it. Without it, the brief asks for a full
  frame. The very-wide-crop line, the hero and poster prompts and an old margin lesson all used to ask for
  empty space or a model-drawn logo; they don't anymore.
- No words reach the image model unless you pass `exactText`.
- A prompt linter checks every brief for instructions that contradict each other (space against full
  frame, text against no text, a logo the model would draw), and the tests run it across every asset
  type, crop and text option. Briefs return `prompt_warnings` if anything slips through.
- Lessons are split into rules for the image model and `review_notes` for your own review, and ranked by
  how specific they are to the asset, so new lessons actually reach the prompt.
- 15 craft rules paraphrased from the official OpenAI and Google image and video prompting guides,
  Anthropic's Apache-2.0 design skills and NN/g research, with sources in `docs/craft-sources.md`.

**It sets text and logos itself, and delivers per platform**
- `brand_profiles`: register the brands you publish under, each with who publishes (a person or a
  company), its real logo files, palette and fonts. `design_brief` takes `brand_id`.
- `compose`: renders the headline and the right brand's real logo over the art. The calmest corner is
  measured and gets the text, the text box stops where the art gets busy, colour and a soft scrim are
  chosen for at least 4.5:1 contrast, one colour, no glow, no eyebrow label, and a logo on its own tile
  gets a feathered edge.
- `deliver`: one step to a platform's file (linkedin-feed, instagram-story, x-post, github-social and
  more): exact size, the smallest JPEG that still looks identical, metadata stripped, under the
  platform's size limit, checked for an empty band.

**It measures instead of trusting**
- `composition_check` finds empty bands at the edges, including gradient skies, crops them away while
  keeping a target aspect, and treats edges you left calm on purpose as planned.
- `design_audit` measures the file it's given and caps the self-scores when there's an empty band or a
  thumbnail that reads as one flat tone, so the model can't pass its own bad result.
- `design_feedback`: corrections the user gives are kept locally and applied on the next brief. Only
  the positive instruction reaches the image model; text and logo corrections come back as compositing
  rules; a correction can be tied to one brand; `list` and `forget` manage them.

**Fixes**
- Flow picks its image and video models by family from the live menu (it dropped "Nano Banana 2"), and
  `NOAPI_FLOW_IMAGE_MODEL` pins one. An aspect Flow doesn't offer now fails with a clear message instead
  of silently generating at the last one used. `4:5` is accepted.
- With browser sharing on, two sessions no longer share one Flow project, so one can't pick up the
  other's image. Joining another session's browser now checks it's really the one that holds this
  profile, and a profile handover mid-launch waits instead of failing.
- `media_optimize` writes JPEG or PNG too (`format`, or a .jpg/.png output path), with the same SSIM
  search, and says when a result is larger than the original.
- `social_sizes` fills the frame by default, writes SSIM-targeted JPEGs with metadata stripped, and adds
  `linkedin-square-1080` and `linkedin-link-1200x627`. The old `linkedin-1200x627` still works but is
  left out of the defaults: it's the link-preview shape, not the feed size.
- Audience personas pick the most specific match, so "security engineers" is no longer read as developers.

Tests: 259 pass. Live checks on real files: composition_check found the actual 30% band, design_audit
capped a 5/5 self-score on that image to revise, compose and deliver produced a clean 1080x1350 LinkedIn
file, and the shared browser was re-tested with two real processes, both shared and queued.


## 1.0.0 (2026-10-11)

The first stable release. Nothing new is bolted on here: 1.0.0 is the 0.11.0 feature set, now treated as
stable, which means the tool names, their inputs and the config keys won't change in a breaking way
without a new major version. What that covers, in short:

- Images and videos from the plans you already pay for (Codex, ChatGPT, Google Flow and Gemini,
  Higgsfield, and JSON-defined sites), with an automatic fallback chain when a provider breaks.
- Art direction built in: `design_brief`, the eye-catch `design_audit`, audience personas, curated
  palettes and font pairings, and asset types from logos to 3D environment maps.
- A local media studio: `media_optimize`, `social_sizes`, `contact_sheet`, `palette_extract`,
  `loop_check`, `video_edit`, background removal.
- It learns from its own audits and remembers what shipped, all in local journals that never leave
  the machine.
- Several sessions at once, side by side as separate tabs. **Changed from 0.11.0: `share_browser` is
  now on by default**, because the server is meant to run on your own machine. It opens a loopback-only
  devtools port while the browser is open; on a shared machine turn it off with
  `no-api-media-mcp config set share_browser false`, and a second session waits in a fair queue instead.
- Notify-only update checks, with opt-in auto-install.


## 0.11.0 (2026-10-11)

- **Several Claude sessions at once, without the "already open" failure.** Every session runs its own copy
  of this server, and Chrome lets only one of them hold the signed-in profile. Before, the second session
  just failed. Now it joins a small machine-wide queue and its progress messages say where it is ("number 1
  in line, waited 13s"), plus an estimate once there's enough history, taken from how long recent browser
  jobs on this machine actually took (time spent queued is left out of those timings). It carries on by
  itself when the browser frees up, and a session that finishes hands the browser over within seconds when
  someone is waiting, instead of keeping it idle for ten minutes.
- **`share_browser` (opt-in): sessions side by side.** With `no-api-media-mcp config set share_browser true`
  (or `NOAPI_SHARE_BROWSER=1`), a second session joins the first one's browser as another tab and both jobs
  run at the same time. It's off by default because it opens a loopback-only devtools port while the
  browser is open, which any local process could attach to; SECURITY.md says so plainly. A session that
  joined never closes the browser for the one that launched it.
- If the profile is held by something that isn't this server (the sign-in window, a leftover Chrome), the
  wait gives up after about ten seconds with a clear message instead of queueing for twenty minutes.
- **The brief now asks before it guesses.** `design_brief` returns `needs_from_user` when it doesn't know
  where the asset will be used (that sets the size and crop) or what post or page it goes with (that sets
  the message), and the server's instructions tell clients to ask the user those questions once before
  generating.
- Tests: 214 pass, plus live runs with two real processes on a throwaway profile and the bundled Chromium:
  queued handover with share_browser off, true side by side tabs with it on (the joining session closing
  never killed the other one's tab), and the fast failure when a plain Chrome window holds the profile.


## 0.10.0 (2026-10-10)

- **Two new asset types for 3D and WebGL sites.** `texture`: a seamless, tileable surface for a website
  background or a Three.js material map. `environment-map`: a seamless 2:1 equirectangular panorama for
  reflections and ambient lighting in a Three.js or WebGL scene. Both come with their own critique
  questions (does it tile with no seam, does the left edge join the right edge) instead of the normal
  photo-realism checklist, since neither is a picture anyone looks at directly.
- **`loop_check`**: for a background-video or product-video meant to loop, compares its first and last
  frame with the same structural-similarity check `media_optimize` already uses for quality loss, and
  reports whether it will look seamless on repeat.
- **`palette_extract`**: reads the dominant colours out of a real image and returns them as hex codes with
  their share of the image, plus a ready `:root` CSS custom-properties block, so a site's design system can
  be built to match what actually got generated instead of guessing. It names colours by how dominant they
  are, never by a guessed role: deciding which one is the primary or the accent is still a human call.
- **The server now recognises the kind of project it's in on its own**: a GitHub repo, a single social
  post, a 3D/WebGL site (three.js, react-three-fiber, Babylon, Spline, checked the same way
  `project_profile` already reads the project), or an animated landing page, and goes straight to the
  matching asset types and tools instead of waiting to be told each time.
- Tests: 195 pass, including a live run of `loop_check` against a real seamless and a real non-seamless
  clip, and of `palette_extract` against a real generated image.


## 0.9.0 (2026-10-10)

- **The server remembers what actually shipped.** `design_audit` can now carry the `style` (tier and look) a
  draft used. Once enough drafts of one asset type have shipped under a real majority tier, `design_brief`
  defaults to that tier (and look) on its own, instead of always falling back to premium. An explicit tier or
  look you ask for still always wins.
- **One honest question added for every realistic asset.** Meta has said a plain AI disclosure label does not
  by itself cut a post's reach; what does get penalised is content that reads as a real photo of something
  that never happened. `design_brief`'s critique list now asks that question directly for hero images,
  illustrations, product shots, social posts, banners, posters, infographics and video (a flat logo or app
  icon is excluded, since neither can be mistaken for a photo).
- **A starting point for alt text.** Every `design_brief` response now includes `alt_text_suggestion`: a
  template built from the asset type and subject, clearly marked as a placeholder to replace once the result
  has actually been looked at, never a fabricated description.
- **More platforms in `social_sizes`.** Added Facebook cover and event cover, a YouTube channel banner, an
  X/Twitter profile header, and a TikTok profile size, with a note on keeping the subject inside the centre
  third so it survives different crops on different devices.
- **`contact_sheet`**: lays up to 12 draft images out on one grid for side-by-side comparison, so directions
  or iterations can be judged against each other instead of one at a time. No text is drawn into the image;
  the result lists which grid position holds which file instead.
- **`usage_report`**: totals a project's own `.ai-media/manifest.jsonl` by provider, file type and day.
  Nothing leaves the machine; it only reads what the server already wrote while saving each result.
- Tests: 189 pass, including a live run of `contact_sheet` against two real drafts (confirmed a real JPEG
  grid on disk) and of `usage_report` against a real manifest.


## 0.8.0 (2026-10-10)

- **A provider that fails doesn't stop the run.** `image_generate` accepts `fallback_providers`: an ordered
  list to try if the first one fails, for example a site redesign breaking a browser-driven provider's
  selector. The result reports every attempt and why each one failed, so nothing is hidden.
- **A second local journal, this one operational.** Every provider call's outcome is recorded (success, or a
  failure classified as login, quota, timeout, selector or network), separate from the design-quality journal
  in `design_audit`. When a provider fails three times in a row with the same kind of error, the next failure
  message says so plainly: that is a real pattern, not a one-off, and is the kind of thing SECURITY.md already
  warns can happen when a site changes its page. Nothing here is uploaded; messages are redacted before being
  written to disk.
- Tests: 170 pass, including a live run that made Gemini fail for real (no account signed in) and confirmed
  it fell through to Codex and reported both attempts.


## 0.7.0 (2026-10-10)

- **Audience personas.** `design_brief` now recognises who the asset is actually for from `context.audience`
  (an executive/CISO, developers, the open source community, security analysts, or the general public),
  sourced from a reviewed design skill's product and style data, not invented. Each one changes the art
  direction's tone, its default tier and palette (only when you didn't set your own), and adds one honest
  critique question asked from that reader's seat, for example "would a developer believe this, or tune it
  out as marketing?". The brief reports which persona matched so you can see the reasoning.
- **Motion timing grounded in real motion-design guidance**, not invented: ease out on the way in, ease in on
  the way out, an exit about two thirds the length of the entrance, one cause-and-effect per shot. Folded
  into the background-video and product-video briefs. This project renders real video with ffmpeg; it has
  no runtime dependency on an animation library, the guidance just comes from the same source.
- Tests: 154 pass.


## 0.6.0 (2026-10-10)

- **Checks for a new version.** Once a day (configurable), the server checks this project's GitHub releases and
  tells you in `status`/`setup`, and once at startup, when a newer version is out: what changed and the exact
  command to update (`npm install -g no-api-media-mcp@latest`). It only ever notifies: it never patches the
  running server, and it never installs anything on its own unless you set `NOAPI_AUTO_UPDATE=1`, in which case
  it runs a real `npm install -g` (no shell, scrubbed environment) once a newer version is found, and the new
  version is used from the next run. Disable the check entirely with `NOAPI_CHECK_UPDATES=0`. The network call
  is a plain, unauthenticated read of this repo's own GitHub releases, with a byte cap and a short timeout, and
  it never breaks a real tool call if it fails.
- **Curated palettes and a real font pairing.** `design_brief` now fills in a brand palette (when you didn't
  supply one) and suggests a heading/body Google Fonts pairing for whatever wordmark or text you composite
  afterwards, picked by the same field detection `design_brief` already does (cyber security, infrastructure,
  AI coding). Both are sourced from a reviewed UI design skill's colour and typography database, not invented.
  A system font was a quiet reason banners looked plain; a real display font like Space Grotesk is most of
  the difference between a plain banner and a premium one.
- New named look `cyber-matrix`: a flatter, higher-contrast alternative to neon-glass (near-black, one
  signal-green accent, muted red only for danger), also sourced from that same database.
- Tests: 146 pass.


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
