import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { imageSize, JobGate, redact, resolveOutput, slugify, sniff } from "../src/safety.js";

// realpath: on macOS the temp dir /var is a symlink to /private/var, and resolveOutput returns real paths.
const root = realpathSync(mkdtempSync(join(tmpdir(), "aam-root-")));
const outside = mkdtempSync(join(tmpdir(), "aam-out-"));
after(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

const base = { roots: [root], provider: "codex", prompt: "a green shield", ext: ".png" };

describe("resolveOutput: where files may be written", () => {
  it("defaults to <root>/.ai-media/<provider>/", () => {
    const p = resolveOutput(base);
    assert.ok(p.startsWith(join(root, ".ai-media", "codex")));
    assert.match(p, /\d{4}-\d{2}-\d{2}-a-green-shield\.png$/);
  });

  it("accepts a normal project path", () => {
    assert.ok(resolveOutput({ ...base, outputPath: "public/img/hero.png" }).endsWith(join("public", "img", "hero.png")));
  });

  for (const bad of ["../escape.png", "../../etc/x.png", "public/../../x.png"]) {
    it(`blocks traversal: ${bad}`, () => assert.throws(() => resolveOutput({ ...base, outputPath: bad }), /outside the allowed/));
  }

  it("blocks absolute paths outside the project", () => {
    assert.throws(() => resolveOutput({ ...base, outputPath: join(outside, "x.png") }), /outside the allowed/);
  });

  it("blocks UNC / network paths", () => {
    assert.throws(() => resolveOutput({ ...base, outputPath: "\\\\evil-host\\share\\x.png" }), /UNC/);
    assert.throws(() => resolveOutput({ ...base, outputPath: "//evil-host/share/x.png" }), /UNC/);
  });

  for (const bad of ["start.bat", "run.ps1", "x.exe", "a.js", "notes", ".bashrc", "x.png.lnk"]) {
    it(`blocks non-media target: ${bad}`, () => assert.throws(() => resolveOutput({ ...base, outputPath: bad })));
  }

  it("blocks hidden file names", () => assert.throws(() => resolveOutput({ ...base, outputPath: "public/.hidden.png" }), /Hidden/));

  it("refuses to overwrite unless asked", () => {
    mkdirSync(join(root, "pub"), { recursive: true });
    writeFileSync(join(root, "pub", "a.png"), "x");
    assert.throws(() => resolveOutput({ ...base, outputPath: "pub/a.png" }), /already exists/);
    assert.ok(resolveOutput({ ...base, outputPath: "pub/a.png", overwrite: true }));
  });

  it("blocks a symlinked folder that points outside the project", (t) => {
    const link = join(root, "linked");
    try {
      symlinkSync(outside, link, "junction");
    } catch {
      t.skip("cannot create links on this machine");
      return;
    }
    assert.throws(() => resolveOutput({ ...base, outputPath: "linked/x.png" }), /outside the allowed/);
  });

  it("never reuses a name in the default folder", () => {
    const a = resolveOutput({ ...base, prompt: "same" });
    writeFileSync(a, "x");
    const b = resolveOutput({ ...base, prompt: "same" });
    assert.notEqual(a, b);
  });
});

describe("redact: nothing that identifies the account leaves the server", () => {
  it("strips query strings (signed media URLs carry session tokens)", () => {
    assert.equal(redact("https://files.example.com/a.png?sig=abc&exp=1"), "https://files.example.com/a.png?…");
  });
  it("masks emails", () => assert.equal(redact("Google Account: someone.name@gmail.com"), "Google Account: <email>"));
  it("masks JWTs and API keys", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    assert.equal(redact(`t=${jwt}`), "t=<jwt>");
    assert.equal(redact("key AIzaFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00"), "key <secret>");
    assert.equal(redact("key AQ.FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00"), "key <secret>");
    assert.equal(redact("tok ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "tok <secret>");
  });
});

describe("sniff: type comes from bytes, not from the server", () => {
  it("detects png/jpeg/webp/mp4 and rejects html", () => {
    assert.equal(sniff(Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"))?.ext, ".png");
    assert.equal(sniff(Buffer.from("ffd8ffe000104a4649460001", "hex"))?.ext, ".jpg");
    assert.equal(sniff(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))?.ext, ".webp");
    assert.equal(sniff(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypisom")]))?.ext, ".mp4");
    assert.equal(sniff(Buffer.from("<!doctype html><html>")), null);
  });
  it("reads PNG size", () => {
    const b = Buffer.alloc(24);
    b[0] = 0x89;
    b.write("PNG", 1, "ascii");
    b.write("IHDR", 12, "ascii");
    b.writeUInt32BE(1200, 16);
    b.writeUInt32BE(630, 20);
    assert.deepEqual(imageSize(b), { width: 1200, height: 630 });
  });
});

describe("JobGate: one job at a time, with a gap", () => {
  it("serialises jobs and waits the gap", async () => {
    const g = new JobGate(150);
    const order: number[] = [];
    const t0 = Date.now();
    await Promise.all([g.run("p", async () => order.push(1)), g.run("p", async () => order.push(2))]);
    assert.deepEqual(order, [1, 2]);
    assert.ok(Date.now() - t0 >= 140);
  });
  it("a failed job does not block the next one", async () => {
    const g = new JobGate(0);
    await assert.rejects(g.run("p", async () => { throw new Error("boom"); }));
    assert.equal(await g.run("p", async () => 7), 7);
  });
});

describe("slugify", () => {
  it("keeps names safe", () => {
    assert.equal(slugify("../../Hero <script>"), "hero-script");
    assert.equal(slugify("اردو تصویر"), "اردو-تصویر");
    assert.equal(slugify("***"), "media");
  });
});
