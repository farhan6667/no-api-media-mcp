import { strict as assert } from "node:assert";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CHROME_MISSING, readState, requireChrome } from "../src/config.js";
import { autoCleanup, cleanup, markDraft, mediaDirIsSafe, plainOrMissing, resetAutoCleanup } from "../src/housekeeping.js";
import { installedFromNpm, launchArgs } from "../src/install.js";
import { projectProfile } from "../src/project.js";
import { readManifest } from "../src/report.js";
import { confineInput, isNetworkPath, resolveOutput } from "../src/safety.js";

/**
 * Regression tests for the 2026-10 adversarial QA pass. Each one is an attack that worked (or would have,
 * on a machine that allows the link) against 1.4.0: a cloned repo that ships a link, a hostile path from a
 * prompt-injected agent, a damaged state file. Links that this machine can't create are skipped, not faked;
 * CI runs them on Linux and macOS where git checks symlinks out by default.
 */

const DAY = 86_400_000;
const made: string[] = [];
const temp = (prefix: string) => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

/** A link of the given kind, or the error code when this machine doesn't allow it (Windows without developer mode). */
function link(target: string, path: string, type: "junction" | "file" | "dir"): true | string {
  try {
    symlinkSync(target, path, type);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? "failed";
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 0)]);
function oldFile(f: string, ageDays: number, body: Buffer = PNG) {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, body);
  const t = (Date.now() - ageDays * DAY) / 1000;
  utimesSync(f, t, t);
}

describe("a planted .ai-media link can't turn cleanup into deleting the user's files", () => {
  it("cleanup refuses a .ai-media junction that points outside the project, and the outside file survives", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    oldFile(join(outside, "precious-photo.png"), 60);
    const made = link(outside, join(root, ".ai-media"), "junction");
    if (made !== true) return t.skip(`cannot create a junction here (${made})`);
    assert.equal(mediaDirIsSafe(root), false);
    assert.throws(() => cleanup(root, { dryRun: false, days: { rejected: 3, used: 14, draft: 30 } }), /link or junction/);
    resetAutoCleanup();
    assert.equal(autoCleanup(root, true), undefined);
    assert.ok(existsSync(join(outside, "precious-photo.png")), "the file outside the project must still be there");
  });

  it("status and manifest are never read or written through the link", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    const made = link(outside, join(root, ".ai-media"), "junction");
    if (made !== true) return t.skip(`cannot create a junction here (${made})`);
    markDraft(root, join(root, ".ai-media", "x.png"), { status: "rejected" });
    assert.ok(!existsSync(join(outside, "status.json")));
    writeFileSync(join(outside, "manifest.jsonl"), JSON.stringify({ time: "t", provider: "p" }) + "\n");
    assert.throws(() => readManifest(root), /link or junction/);
  });

  it("a .ai-media symlink (Linux, macOS) is refused the same way", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    oldFile(join(outside, "precious-photo.png"), 60);
    const made = link(outside, join(root, ".ai-media"), "dir");
    if (made !== true) return t.skip(`cannot create a symlink here (${made})`);
    assert.throws(() => cleanup(root, { dryRun: false }), /link or junction/);
    assert.ok(existsSync(join(outside, "precious-photo.png")));
  });

  it("a status.json or manifest.jsonl hard-linked to another file is never written or read", () => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    mkdirSync(join(root, ".ai-media"), { recursive: true });
    writeFileSync(join(outside, "bashrc"), "original\n");
    linkSync(join(outside, "bashrc"), join(root, ".ai-media", "status.json"));
    markDraft(root, join(root, ".ai-media", "x.png"), { status: "rejected", note: "user: anything" });
    assert.equal(readFileSync(join(outside, "bashrc"), "utf8"), "original\n");
    assert.equal(plainOrMissing(join(root, ".ai-media", "status.json")), false);
    writeFileSync(join(outside, "m"), JSON.stringify({ time: "t", provider: "p" }) + "\n");
    linkSync(join(outside, "m"), join(root, ".ai-media", "manifest.jsonl"));
    assert.throws(() => readManifest(root), /link or junction/);
  });

  it("a status.json symlink (Linux, macOS) is never written through", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    mkdirSync(join(root, ".ai-media"), { recursive: true });
    const made = link(join(outside, "target"), join(root, ".ai-media", "status.json"), "file");
    if (made !== true) return t.skip(`cannot create a file symlink here (${made})`);
    markDraft(root, join(root, ".ai-media", "x.png"), { status: "rejected" });
    assert.ok(!existsSync(join(outside, "target")), "a dangling status.json link created its target");
  });

  it("the media_cleanup defaults really apply when the tool leaves the day counts out", () => {
    const root = temp("noapi-adv-root-");
    oldFile(join(root, ".ai-media", "codex", "old.png"), 45);
    const r = cleanup(root, { dryRun: false, days: { rejected: undefined, used: undefined, draft: undefined } as never });
    assert.deepEqual(r.removed.map((x) => x.file), [".ai-media/codex/old.png"]);
  });
});

describe("project_profile reads only the project itself", () => {
  it("never walks a junction to another folder", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    writeFileSync(join(outside, "secret.html"), "<style>body{background:#abcdef}.x{color:#123abc}</style>");
    const made = link(outside, join(root, "docs"), "junction");
    if (made !== true) return t.skip(`cannot create a junction here (${made})`);
    const p = projectProfile(root);
    assert.ok(!p.palette.includes("#abcdef"), "colours from a file outside the project leaked in");
  });

  it("a README.md that links to a secrets file is not read into `about`", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    const secret = "aws_access_key_id = AKIAEXAMPLEEXAMPLE1 and aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY plus more words";
    writeFileSync(join(outside, "credentials"), `# creds\n\n${secret}\n`);
    const made = link(join(outside, "credentials"), join(root, "README.md"), "file");
    if (made !== true) return t.skip(`cannot create a file symlink here (${made})`);
    const p = projectProfile(root);
    assert.doesNotMatch(JSON.stringify(p), /AKIAEXAMPLE|wJalrXUtn/);
  });

  it("still reads a normal README", () => {
    const root = temp("noapi-adv-root-");
    writeFileSync(join(root, "README.md"), "# Demo\n\nA small demo project that makes calm images for a website, written for this test only.\n");
    assert.equal(projectProfile(root).name, "Demo");
    assert.match(projectProfile(root).about ?? "", /small demo project/);
  });
});

describe("input paths are confined before the disk is touched", () => {
  const root = temp("noapi-adv-root-");
  const outside = temp("noapi-adv-out-");
  writeFileSync(join(root, "art.png"), PNG);
  writeFileSync(join(outside, "real.png"), PNG);

  for (const p of ["\\\\attacker.example\\share\\x.png", "//attacker.example/share/x.png", "\\\\?\\C:\\Windows\\win.ini", "\\\\.\\pipe\\x"]) {
    it(`refuses the network or device path ${JSON.stringify(p)} by its text`, () => {
      assert.equal(isNetworkPath(p), true);
      assert.throws(() => confineInput([root], p), /Network \(UNC\)/);
    });
  }

  it("gives the same answer for an outside file that exists and one that doesn't (no existence oracle)", () => {
    const a = (() => {
      try {
        confineInput([root], join(outside, "real.png"));
      } catch (e) {
        return (e as Error).message.replace(/:.*/, "");
      }
    })();
    const b = (() => {
      try {
        confineInput([root], join(outside, "missing.png"));
      } catch (e) {
        return (e as Error).message.replace(/:.*/, "");
      }
    })();
    assert.equal(a, "Input must be inside the project");
    assert.equal(a, b);
  });

  it("refuses traversal, empty and null-byte paths, accepts a real project file", () => {
    assert.throws(() => confineInput([root], "../" + "x.png"), /inside the project/);
    assert.throws(() => confineInput([root], ""), /empty/);
    assert.throws(() => confineInput([root], "art.png\0.txt"), /null byte/);
    assert.equal(confineInput([root], "art.png"), join(root, "art.png"));
  });

  it("refuses a junction inside the project that leads outside it", (t) => {
    const made = link(outside, join(root, "linked"), "junction");
    if (made !== true) return t.skip(`cannot create a junction here (${made})`);
    assert.throws(() => confineInput([root], "linked/real.png"), /inside the project/);
  });
});

describe("output paths through links that point nowhere", () => {
  const base = { provider: "codex", prompt: "x", ext: ".png" };

  it("a dangling junction is refused, not created on the far side", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    const made = link(join(outside, "not-yet"), join(root, "out"), "junction");
    if (made !== true) return t.skip(`cannot create a junction here (${made})`);
    assert.throws(() => resolveOutput({ ...base, roots: [root], outputPath: "out/x.png" }), /points nowhere|outside the allowed/);
    assert.ok(!existsSync(join(outside, "not-yet")));
  });

  it("a dangling file symlink is refused even with overwrite (it would write wherever it points)", (t) => {
    const root = temp("noapi-adv-root-");
    const outside = temp("noapi-adv-out-");
    const made = link(join(outside, "planted.png"), join(root, "hero.png"), "file");
    if (made !== true) return t.skip(`cannot create a file symlink here (${made})`);
    assert.throws(() => resolveOutput({ ...base, roots: [root], outputPath: "hero.png", overwrite: true }), /points nowhere/);
    assert.ok(!existsSync(join(outside, "planted.png")));
  });
});

describe("startup never dies on things a user can fix", () => {
  it("a damaged state.json reads as empty instead of crashing the server", () => {
    const home = temp("noapi-adv-home-");
    writeFileSync(join(home, "state.json"), "{broken");
    assert.deepEqual(readState({ home }), {});
    writeFileSync(join(home, "state.json"), "[1,2]");
    assert.deepEqual(readState({ home }), {});
  });

  it("a missing Chrome is reported by the tool that needs it, not at startup", () => {
    assert.throws(() => requireChrome({ chromePath: "" }), (e: Error) => e.message === CHROME_MISSING);
    assert.throws(() => requireChrome({ chromePath: join(tmpdir(), "no-such-chrome.exe") }), /Chrome not found/);
  });
});

describe("the commands we print must start this copy, not whatever npm has under the name", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  it("a git checkout is told to run node with its own absolute path", () => {
    assert.equal(installedFromNpm("/home/a/no-api-media-mcp/dist/src/index.js"), false);
    assert.equal(installedFromNpm("C:\\Users\\a\\AppData\\Roaming\\npm\\node_modules\\no-api-media-mcp\\dist\\src\\index.js"), true);
    const l = launchArgs("/x/dist/src/index.js");
    assert.equal(l.command, "node");
    assert.deepEqual(l.args, ["/x/dist/src/index.js"]);
  });
  it("setup and help never print an npx line", () => {
    for (const f of ["setup.js", "index.js"]) {
      // Code only: comments may explain why npx is never printed.
      const src = readFileSync(join(here, "..", "src", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      assert.doesNotMatch(src, /npx (-y )?no-api-media-mcp/, f);
    }
  });
});

describe("end to end over stdio, the way an MCP client calls it", () => {
  it("UNC paths, a planted .ai-media junction and a damaged state file are all handled", async (t) => {
    const work = temp("noapi-adv-e2e-");
    const proj = join(work, "proj");
    const home = join(work, "home");
    const outside = join(work, "outside");
    for (const d of [proj, home, outside]) mkdirSync(d, { recursive: true });
    writeFileSync(join(home, "state.json"), "{broken");
    oldFile(join(outside, "precious-photo.png"), 60);
    const junction = link(outside, join(proj, ".ai-media"), "junction");

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js")],
      cwd: proj,
      env: { ...(process.env as Record<string, string>), NOAPI_HOME: home, NOAPI_CHECK_UPDATES: "0", NOAPI_AUTO_UPDATE: "0" },
      stderr: "ignore",
    });
    const client = new Client({ name: "adversarial-test", version: "0" });
    await client.connect(transport);
    try {
      const text = (r: unknown) => ((r as { content: { text: string }[] }).content[0]?.text ?? "");
      const unc = await client.callTool({ name: "media_probe", arguments: { input_path: "\\\\localhost\\no-such-share\\x.png" } });
      assert.equal(unc.isError, true);
      assert.match(text(unc), /Network \(UNC\)/);

      if (junction !== true) return t.skip(`cannot create a junction here (${junction}); UNC and state checks passed`);
      const clean = await client.callTool({ name: "media_cleanup", arguments: { dry_run: false, rejected_days: 3, used_days: 14, draft_days: 30 } });
      assert.equal(clean.isError, true);
      assert.match(text(clean), /link or junction/);
      assert.ok(existsSync(join(outside, "precious-photo.png")), "media_cleanup deleted a file outside the project");
      const usage = await client.callTool({ name: "usage_report", arguments: {} });
      assert.equal(usage.isError, true);
    } finally {
      await client.close();
    }
  });
});
