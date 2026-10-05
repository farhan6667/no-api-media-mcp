// Regression tests for the pre-release security audit. Each block names the finding it locks down.
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { StopWaiting, waitFor } from "../src/browser.js";
import { npmGlobalRoots, scrubbedEnv } from "../src/config.js";
import { CODEX_SAFETY_ARGS } from "../src/providers/codex.js";
import { siteDomain } from "../src/providers/generic.js";
import { assertPublicHttps, maskAccount, redact, resolveOutput, sniff } from "../src/safety.js";

const root = mkdtempSync(join(tmpdir(), "aam-audit-"));
after(() => rmSync(root, { recursive: true, force: true }));
const base = { roots: [root], provider: "x", prompt: "p", ext: ".png" };

describe("S1: no npm lookup through a shell in the project folder", () => {
  it("npmGlobalRoots never includes the current directory", () => {
    const cwd = process.cwd().toLowerCase();
    for (const r of npmGlobalRoots()) assert.notEqual(r.toLowerCase(), cwd);
  });
  it("source files no longer call cmd.exe or `npm root`", () => {
    for (const f of ["codex", "higgsfield"]) {
      const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "providers", `${f}.ts`), "utf8");
      assert.doesNotMatch(src, /ComSpec|cmd\.exe|"root", "-g"/, f);
    }
  });
});

describe("S2: API keys never reach child CLIs", () => {
  it("strips API-key-like variables", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.CODEX_API_KEY = "x";
    process.env.SOME_SERVICE_TOKEN = "t";
    process.env.HIGGSFIELD_API_KEY = "h";
    const e = scrubbedEnv();
    for (const k of ["OPENAI_API_KEY", "CODEX_API_KEY", "SOME_SERVICE_TOKEN", "HIGGSFIELD_API_KEY"]) assert.equal(e[k], undefined, k);
    assert.ok(e.PATH ?? e.Path, "PATH must survive");
    delete process.env.OPENAI_API_KEY;
    delete process.env.CODEX_API_KEY;
    delete process.env.SOME_SERVICE_TOKEN;
    delete process.env.HIGGSFIELD_API_KEY;
  });
  it("forces ChatGPT login and turns sandbox network off for Codex", () => {
    assert.ok(CODEX_SAFETY_ARGS.includes('forced_login_method="chatgpt"'));
    assert.ok(CODEX_SAFETY_ARGS.includes("sandbox_workspace_write.network_access=false"));
  });
});

describe("S4: media is only fetched from the provider's own public hosts", () => {
  it("allows the provider host and its subdomains", () => {
    assert.doesNotThrow(() => assertPublicHttps("https://lh3.googleusercontent.com/a.png", ["googleusercontent.com"]));
  });
  it("blocks other hosts, http, IPs and local names", () => {
    assert.throws(() => assertPublicHttps("https://evil.example/a.png", ["googleusercontent.com"]), /unexpected host/);
    assert.throws(() => assertPublicHttps("https://googleusercontent.com.evil.example/a.png", ["googleusercontent.com"]));
    assert.throws(() => assertPublicHttps("http://googleusercontent.com/a.png"));
    assert.throws(() => assertPublicHttps("https://192.168.1.1/a.png"));
    assert.throws(() => assertPublicHttps("https://[::1]/a.png"));
    assert.throws(() => assertPublicHttps("https://localhost/a.png"));
    assert.throws(() => assertPublicHttps("https://router/a.png"));
    assert.throws(() => assertPublicHttps("file:///C:/x.png"));
  });
  it("derives the site domain for JSON specs", () => assert.equal(siteDomain("https://www.grok.com/imagine"), "grok.com"));
});

describe("S5: redaction covers Google cookies, OAuth tokens, usernames and display names", () => {
  it("masks cookies and tokens", () => {
    const out = redact("__Secure-1PSID=abc123; SAPISID=zzz; ya29.a0AfH6SMBxxxxxxxxxxxxxxxxxxxx 1//0gAbcdefghijklmnopqrstuvwx xai-abcdefghijklmnopqrstuvwxyz");
    for (const leak of ["abc123", "zzz", "ya29.a0", "1//0gAbc", "xai-abc"]) assert.ok(!out.includes(leak), `${leak} leaked: ${out}`);
  });
  it("replaces home folders", () => {
    assert.equal(redact("C:\\Users\\someone\\proj\\a.png"), "~\\proj\\a.png");
    assert.equal(redact("/home/someone/proj"), "~/proj");
    assert.equal(redact("/Users/someone/proj"), "~/proj");
    // JSON-escaped, as it appears inside tool output
    assert.equal(redact(JSON.stringify({ p: "C:\\Users\\someone\\proj" })), '{"p":"~\\\\proj"}');
  });
  it("never returns a display name", () => {
    assert.equal(maskAccount("Google Account: Jane Doe (jane.doe@gmail.com)"), "j***@gmail.com");
    assert.equal(maskAccount("Google Account: Jane Doe"), "signed in");
  });
});

describe("S6: Windows file name tricks", () => {
  for (const bad of ["a.png:evil.png", "public/x.png:stream", "CON.png", "nul.png", "Aux.png", "com1.png", "LPT9.png", "pub/con/x.png", "a.png.", "a.png "]) {
    it(`rejects ${JSON.stringify(bad)}`, () => assert.throws(() => resolveOutput({ ...base, outputPath: bad })));
  }
  it("still accepts a drive-qualified path inside the root", () => {
    assert.ok(resolveOutput({ ...base, outputPath: join(root, "ok", "a.png") }));
  });
  it("still accepts names that merely start like a device", () => {
    assert.ok(resolveOutput({ ...base, outputPath: "console.png" }));
    assert.ok(resolveOutput({ ...base, outputPath: "nullify.png" }));
  });
});

describe("C1: a failure seen while waiting stops the wait at once", () => {
  it("StopWaiting propagates, ordinary errors are retried", async () => {
    let calls = 0;
    const t0 = Date.now();
    await assert.rejects(
      waitFor(async () => {
        calls++;
        if (calls === 1) throw new Error("flaky");
        throw new StopWaiting("blocked");
      }, 60_000, 10),
      /blocked/,
    );
    assert.equal(calls, 2);
    assert.ok(Date.now() - t0 < 5_000);
  });
});

describe("C8 / S8: real file types", () => {
  it("detects QuickTime .mov", () => {
    assert.equal(sniff(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypqt  ")]))?.ext, ".mov");
  });
  it("rejects a text playlist renamed to .mp4", () => {
    const f = join(root, "fake.mp4");
    writeFileSync(f, "#EXTM3U\nhttp://evil.example/x.ts\n");
    assert.equal(sniff(readFileSync(f)), null);
  });
});
