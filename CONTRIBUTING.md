# Contributing

Thanks for helping. The most useful contributions, in order:

1. **Fixing a broken selector.** AI sites change their pages often. If a tool says it can't find a button or box, open the site, find the new selector, and send a PR. Please say which site, what changed, and the date you tested it.
2. **Adding a site as a JSON spec.** No code needed. Copy one from [`examples/providers`](examples/providers), test it on your own account, and add it there. If it works for a few people we move it into the built-ins.
3. **Adding a site that has an official CLI** (like Codex or Higgsfield). An official CLI with its own login is always better than driving a web page. See `src/providers/higgsfield.ts` for the pattern.

## Rules that keep users' accounts safe

These are not style preferences. PRs that break them won't be merged.

- Never ask for, type, store or log a password, cookie, token or API key.
- Never start a child process with a shell. Use argument arrays and `shell: false`.
- Never write outside the output roots. Go through `resolveOutput()`.
- Never add captcha solving, fingerprint spoofing or any trick to hide automation. If a site puts up a human check, stop and tell the user.
- Anything that spends credits must show the cost first or require explicit confirmation.
- Pass everything you return or log through `redact()`.

## Dev loop

```bash
npm install
npm test
node scripts/smoke.mjs <some-project-dir> status
node scripts/smoke.mjs <some-project-dir> img:flow
```

Run the smoke test with your own accounts before opening a PR that touches a provider, and paste the (redacted) output in the PR.
