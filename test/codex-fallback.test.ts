import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { findGeneratedImage } from "../src/providers/codex.js";

const home = mkdtempSync(join(tmpdir(), "noapi-codexhome-"));
after(() => rmSync(home, { recursive: true, force: true }));

function put(session: string, name: string, bytes: string, whenMs: number): string {
  const dir = join(home, "generated_images", session);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, bytes);
  utimesSync(file, whenMs / 1000, whenMs / 1000);
  return file;
}

describe("Codex generated image fallback", () => {
  const start = Date.now();

  it("returns nothing when Codex has no generated_images folder", () => {
    assert.equal(findGeneratedImage(join(home, "nope"), start), undefined);
  });

  it("ignores pictures that existed before this run started", () => {
    put("old-session", "old.png", "x", start - 60_000);
    assert.equal(findGeneratedImage(home, start), undefined);
  });

  it("picks the newest picture written after the run started", () => {
    put("s1", "a.png", "aaa", start + 1_000);
    const newest = put("s2", "b.jpg", "bbb", start + 5_000);
    assert.equal(findGeneratedImage(home, start), newest);
  });

  it("skips non-picture files, empty files and loose files in the root", () => {
    put("s3", "notes.txt", "text", start + 9_000);
    put("s3", "empty.png", "", start + 9_500);
    writeFileSync(join(home, "generated_images", "stray.png"), "x");
    utimesSync(join(home, "generated_images", "stray.png"), (start + 10_000) / 1000, (start + 10_000) / 1000);
    const found = findGeneratedImage(home, start);
    assert.ok(found && /b\.jpg$/.test(found), String(found));
  });
});
