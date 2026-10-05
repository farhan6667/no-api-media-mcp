# Changelog

## 0.1.0 (unreleased)

First public version.

- Providers: Codex CLI (ChatGPT login), chatgpt.com, Google Flow (Nano Banana 2, Veo 3.1, Omni), Gemini, Higgsfield CLI (OAuth), Grok, and JSON-defined sites.
- Tools: `accounts_login`, `accounts_status`, `providers_list`, `image_generate`, `video_quote`, `video_generate`, `media_optimize`.
- Credit caps for Flow and Higgsfield, explicit confirmation for sites without a price.
- SSIM-checked WebP and H.264 optimisation.
- Security hardening from a pre-release audit: no shell or npm lookup in the project folder, API-key variables stripped from child CLIs, Codex forced to ChatGPT login with sandbox network off, media downloads limited to each provider's own hosts with checked redirects, Windows device names and alternate data streams rejected, wider redaction (Google cookies, OAuth tokens, home folders, display names), browser kept alive during long jobs, MCP progress and cancellation.
