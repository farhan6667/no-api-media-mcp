import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { BUILTIN_SPECS, loadSpecs, SpecSchema } from "../src/providers/generic.js";

const home = mkdtempSync(join(tmpdir(), "aam-home-"));
after(() => rmSync(home, { recursive: true, force: true }));

const good = { id: "my-site", name: "My site", url: "https://example.com/", kinds: ["image"], input: "textarea" };

describe("provider specs", () => {
  it("ships grok as a built-in", () => assert.ok(BUILTIN_SPECS.some((s) => s.id === "grok")));

  it("accepts a valid spec", () => assert.ok(SpecSchema.parse(good)));

  it("rejects plain http (session cookies would travel unencrypted)", () => {
    assert.throws(() => SpecSchema.parse({ ...good, url: "http://example.com/" }));
  });

  it("rejects javascript: and file: urls", () => {
    assert.throws(() => SpecSchema.parse({ ...good, url: "javascript:alert(1)" }));
    assert.throws(() => SpecSchema.parse({ ...good, url: "file:///C:/Windows" }));
  });

  it("rejects ids that could become paths", () => {
    for (const id of ["../x", "a/b", "A", "x y", ""]) assert.throws(() => SpecSchema.parse({ ...good, id }), id);
  });

  it("loads user specs from <home>/providers and reports broken ones without crashing", () => {
    mkdirSync(join(home, "providers"), { recursive: true });
    writeFileSync(join(home, "providers", "ok.json"), JSON.stringify(good));
    writeFileSync(join(home, "providers", "bad.json"), "{ not json");
    const r = loadSpecs(home);
    assert.ok(r.specs.some((s) => s.id === "my-site"));
    assert.equal(r.errors.length, 1);
  });

  it("every file in examples/providers is a valid spec", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = join(import.meta.dirname, "..", "..", "examples", "providers");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    assert.ok(files.length >= 2);
    for (const f of files) assert.doesNotThrow(() => SpecSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))), f);
  });

  it("ignores specs placed in the project folder", () => {
    const project = mkdtempSync(join(tmpdir(), "aam-proj-"));
    mkdirSync(join(project, "providers"), { recursive: true });
    writeFileSync(join(project, "providers", "evil.json"), JSON.stringify({ ...good, id: "evil" }));
    const r = loadSpecs(home);
    assert.ok(!r.specs.some((s) => s.id === "evil"));
    rmSync(project, { recursive: true, force: true });
  });
});
