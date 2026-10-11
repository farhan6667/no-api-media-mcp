# Security

This server holds a logged-in browser session for accounts people pay for. That makes it worth attacking, so the design starts from "what if the agent, a web page, a cloned repo, or a prompt is hostile".

## Threat model and what we do about it

| Risk | Mitigation |
|---|---|
| Password theft | The server never asks for, types or stores a password. `accounts_login` launches plain Chrome with no automation attached; the user signs in by hand. Higgsfield uses its own CLI's OAuth flow, and the server never calls `auth token`. |
| Session theft by another local process | By default Playwright drives Chrome over a **pipe** (`--remote-debugging-pipe`), not a TCP port, so nothing on the machine can attach to the logged-in browser. The login window runs without any debugging flag. The one exception is the opt-in `share_browser` setting (off by default): it adds a loopback-only devtools port so several sessions of this server can use the browser as separate tabs at once, and while that browser is open any local process could attach to it. Leave it off on a shared or untrusted machine. |
| Session files ending up on GitHub | The profile lives in `~/.no-api-media/chrome-profile`, outside every project. `.gitignore` also excludes it, and `.ai-media/` ignores itself. CI runs gitleaks. |
| A cloned repo running code through the server | No shell anywhere. CLIs are located from known install folders, never by running `npm` or `cmd` in the project folder, and child processes start in the temp folder. |
| Prompt text or model names turning into commands or flags | Argument arrays with `shell: false`. Higgsfield values are passed as `--key=value` and model/parameter names are whitelisted by pattern. |
| A paid API being used by accident | All `*_API_KEY`, `*_TOKEN`, `*SECRET*`, `OPENAI_*` and `CODEX_*` variables are removed from the environment of every child CLI. Codex is started with `forced_login_method="chatgpt"` and refuses to run unless `codex login status` reports a ChatGPT login. |
| Prompt injection making the server write elsewhere (Startup folder, `~/.ssh`, `.bashrc`) | Every output path is resolved, symlinks and junctions followed, and must sit inside the allowed roots. Only media extensions; no hidden names, UNC paths, NTFS alternate data streams (`a.png:x`), Windows device names (`CON`, `NUL`, `COM1`...) or names ending in a dot or space. No silent overwrite. Checked before any generation spends quota. |
| A hostile image on a page making us send the user's cookies elsewhere | Media is fetched only from each provider's own hosts (`mediaHosts` for JSON specs), https only, never from IP literals or local names, and every redirect hop is re-checked. |
| Codex doing more than drawing | Codex runs in `workspace-write` mode inside a throwaway temp folder with sandbox network off and no inherited shell environment. **Residual risk:** Codex's sandbox can still read files elsewhere on disk; only the instruction in the task stops it from embedding them. Don't feed it prompts from untrusted sources. |
| Leaking account identity through tool output or logs | Tool output and stderr logs pass through `redact()`: URL query strings (signed media links), emails, JWTs, Google cookies (`SID`, `SAPISID`, `__Secure-*`), Google OAuth access and refresh tokens, common API key formats and home-folder paths are masked. Accounts are reported as `j***@gmail.com`, never by display name. File paths are returned relative to the project. Only the MCP protocol is written to stdout. |
| Saving a web page or script disguised as an image | File type comes from the bytes, never from headers or names. `media_optimize` checks the input's bytes too and restricts ffmpeg to local files (`-protocol_whitelist file`). |
| Resource exhaustion | Browser-side downloads are capped at 200 MB, Higgsfield CDN downloads at 500 MB (streamed, checked as they arrive). Every wait has a timeout. Chrome closes after 10 idle minutes, never while a job is running. |
| Runaway spending | One job at a time, a minimum gap per provider. Flow and Higgsfield read the real cost first and refuse above `max_credits`. Sites without a price need `confirm_spend: true`. |
| Getting the account flagged | Human pace, no captcha solving, no fingerprint spoofing, Chrome's automation bar left on. The server stops at sign-in, consent and "are you human" pages and asks the user. |
| Telemetry | None. The server talks only to the provider sites you use. |
| Editing tools reading or writing the wrong files | Every input of `video_edit`, `social_sizes`, `background_remove` and `media_probe` (including logos, audio and subtitle files) must resolve inside the project; images and videos are checked by their bytes, subtitles must be `.srt`. Outputs go through the same checks as generated files. |
| Filter injection through user text | Overlay text is written to a file and read with `textfile=` with `expansion=none`, so neither `:` nor `%{...}` in the text can add ffmpeg options or call ffmpeg functions. Colours, sizes, positions and numbers are validated against fixed patterns. Subtitles are copied into a private temp folder under a fixed name. |
| ffmpeg fetching other files or URLs | Every input gets `-protocol_whitelist file`. Generated backgrounds use `-f lavfi`, which reads nothing. |
| Background removal leaking images | rembg runs locally on your CPU. The only network use is its one-time model download from the rembg GitHub releases; images never leave the machine. API-key variables are stripped from its environment like every other child process. |
| Cleanup deleting the wrong files | Draft cleanup only considers real media files inside `<project>/.ai-media`. Symbolic links and junctions are skipped, never followed. Final files in the project are never touched, a "used" draft goes only if its final file still exists, status paths with `..` are refused, and `media_cleanup` is a dry run unless you say otherwise. It can be switched off with `auto_cleanup false`. |

## Things you should know

- Chrome encrypts its cookies with your operating-system account (DPAPI on Windows, Keychain on macOS). Any program running as you can ask for them; that's true of your normal Chrome too.
- The Higgsfield CLI binary (`hf.exe`) is not Authenticode-signed. Its npm installer downloads it from Higgsfield's GitHub releases and checks a SHA-256. We verified the release tarball against Higgsfield's `checksums.txt` for 1.1.26.
- Only one server process can use the profile at a time. A second one gets a clear "profile already open" error.
- `media_optimize` strips embedded metadata (EXIF, XMP, C2PA content credentials) from the files it writes, by default and with a report. That is a privacy feature (prompts, software and timestamps don't ship with your site) and a transparency trade-off: viewers lose the provenance badge. Originals keep their manifests, the switch is documented in the README, and invisible watermarks are never touched.

## Tests

`npm test` runs the security suites in `test/`: path traversal, absolute and UNC paths, symlink/junction escape, Windows device names and alternate data streams, non-media and hidden targets, overwrite protection, redaction of emails, signed URLs, JWTs, Google cookies, OAuth tokens and home folders, display-name masking, media host allowlists and private hosts, API-key scrubbing for child processes, Codex safety flags, byte sniffing, wait-loop failure handling and job serialisation.

## Reporting

Please open a private security advisory on GitHub rather than a public issue.

If you can't use GitHub advisories, email nexaforge.services@gmail.com with the subject "no-api-media-mcp security". Say what you found and how to reproduce it, but don't send cookies, tokens or anyone's account data.
