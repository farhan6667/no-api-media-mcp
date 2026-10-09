import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, describe, it } from "node:test";
import { autoCleanup, cleanup, markDraft, readStatus, resetAutoCleanup } from "../src/housekeeping.js";

const root = mkdtempSync(join(tmpdir(), "noapi-hk-"));
after(() => rmSync(root, { recursive: true, force: true }));
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 10);

function draft(rel: string, ageDays: number, bytes = 10): string {
  const f = join(root, rel);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, Buffer.alloc(bytes, 1));
  const t = (NOW - ageDays * DAY) / 1000;
  utimesSync(f, t, t);
  return f;
}

beforeEach(() => {
  rmSync(join(root, ".ai-media"), { recursive: true, force: true });
  rmSync(join(root, "public"), { recursive: true, force: true });
  resetAutoCleanup();
});

describe("draft housekeeping", () => {
  it("removes a rejected draft after the grace period and keeps a fresh one", () => {
    const old = draft(".ai-media/codex/old.png", 5);
    const fresh = draft(".ai-media/codex/fresh.png", 1);
    markDraft(root, old, { status: "rejected" }, NOW - 4 * DAY);
    markDraft(root, fresh, { status: "rejected" }, NOW - 1 * DAY);
    const r = cleanup(root, { dryRun: false, now: NOW });
    assert.deepEqual(r.removed.map((x) => x.file), [".ai-media/codex/old.png"]);
    assert.ok(!existsSync(old));
    assert.ok(existsSync(fresh));
    assert.equal(readStatus(root)[".ai-media/codex/old.png"], undefined);
  });

  it("dry run lists what would go and changes nothing", () => {
    const old = draft(".ai-media/flow/a.png", 40, 1000);
    const r = cleanup(root, { now: NOW });
    assert.equal(r.dryRun, true);
    assert.equal(r.freedBytes, 1000);
    assert.ok(existsSync(old));
  });

  it("removes a used draft only when its final file still exists", () => {
    const a = draft(".ai-media/codex/used-a.png", 20);
    const b = draft(".ai-media/codex/used-b.png", 20);
    draft("public/final-a.webp", 20);
    markDraft(root, a, { status: "used", final: "public/final-a.webp" }, NOW - 20 * DAY);
    markDraft(root, b, { status: "used", final: "public/missing.webp" }, NOW - 20 * DAY);
    const r = cleanup(root, { dryRun: false, now: NOW });
    assert.ok(!existsSync(a));
    assert.ok(existsSync(b), "a used draft whose final file is gone must be kept");
    assert.ok(existsSync(join(root, "public/final-a.webp")), "final assets are never touched");
    assert.equal(r.removed.length, 1);
  });

  it("removes untracked drafts only after the long period", () => {
    draft(".ai-media/codex/recent.png", 10);
    draft(".ai-media/codex/ancient.png", 45);
    const r = cleanup(root, { dryRun: false, now: NOW });
    assert.deepEqual(r.removed.map((x) => x.file), [".ai-media/codex/ancient.png"]);
  });

  it("never touches files outside .ai-media, the manifest, status or dotfiles", () => {
    const outside = draft("public/hero.png", 400);
    const manifest = draft(".ai-media/manifest.jsonl", 400);
    writeFileSync(join(root, ".ai-media/.gitignore"), "*\n");
    cleanup(root, { dryRun: false, now: NOW });
    assert.ok(existsSync(outside));
    assert.ok(existsSync(manifest));
    assert.ok(existsSync(join(root, ".ai-media/.gitignore")));
  });

  it("ignores non-media files", () => {
    const note = draft(".ai-media/codex/notes.txt", 400);
    cleanup(root, { dryRun: false, now: NOW });
    assert.ok(existsSync(note));
  });

  it("does not follow symbolic links", (t) => {
    const target = draft("public/precious.png", 400);
    try {
      mkdirSync(join(root, ".ai-media/codex"), { recursive: true });
      symlinkSync(target, join(root, ".ai-media/codex/link.png"));
    } catch {
      t.skip("symlinks not allowed here");
      return;
    }
    cleanup(root, { dryRun: false, now: NOW });
    assert.ok(existsSync(target));
  });

  it("marks only paths inside .ai-media and rejects traversal", () => {
    assert.equal(markDraft(root, join(root, "public/x.png"), { status: "used" }), false);
    assert.equal(markDraft(root, join(root, ".ai-media/../public/x.png"), { status: "used" }), false);
  });

  it("removes empty folders it leaves behind, but never .ai-media itself", () => {
    draft(".ai-media/codex/only.png", 60);
    cleanup(root, { dryRun: false, now: NOW });
    assert.ok(!existsSync(join(root, ".ai-media/codex")));
    assert.ok(existsSync(join(root, ".ai-media")));
  });

  it("auto cleanup runs once per project, can be switched off and never throws", () => {
    draft(".ai-media/codex/x.png", 60);
    assert.equal(autoCleanup(root, false), undefined);
    assert.ok(existsSync(join(root, ".ai-media/codex/x.png")));
    const first = autoCleanup(root, true);
    assert.equal(first?.removed.length, 1);
    draft(".ai-media/codex/y.png", 60);
    assert.equal(autoCleanup(root, true), undefined, "second call in the same process does nothing");
    assert.equal(autoCleanup(join(root, "does-not-exist"), true), undefined);
  });

  it("survives a damaged status file", () => {
    draft(".ai-media/codex/z.png", 1);
    writeFileSync(join(root, ".ai-media/status.json"), "{not json");
    assert.doesNotThrow(() => cleanup(root, { now: NOW }));
    assert.equal(readFileSync(join(root, ".ai-media/status.json"), "utf8"), "{not json");
  });
});
