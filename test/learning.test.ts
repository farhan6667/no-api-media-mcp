import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { ASSET_TYPES, AUDIT_RUBRIC, designBrief, parseAspect, PROMPT_BUDGET, withAdvice } from "../src/design.js";
import { journalPath, learnedFor, learnedSentence, preferredStyleFor, readJournal, record } from "../src/learning.js";
import { LESSONS, lessonsFor } from "../src/lessons.js";

const home = mkdtempSync(join(tmpdir(), "noapi-learn-"));
after(() => rmSync(home, { recursive: true, force: true }));
const all = (n: number, over: Record<string, number> = {}) => ({ ...Object.fromEntries(AUDIT_RUBRIC.map((r) => [r.id, n])), ...over });

describe("learning from audits", () => {
  it("learns nothing from a single audit", () => {
    record(home, { asset: "banner", scores: all(5, { "not-template": 2 }), average: 4.6, verdict: "revise" });
    assert.deepEqual(learnedFor(readJournal(home), "banner"), []);
  });

  it("learns a criterion that falls short at least twice, and names the fix", () => {
    record(home, { asset: "banner", scores: all(5, { "not-template": 3 }), average: 4.7, verdict: "revise" });
    const l = learnedFor(readJournal(home), "banner");
    assert.equal(l.length, 1);
    assert.equal(l[0].criterion, "not-template");
    assert.ok(l[0].average < 4 && l[0].seen === 2 && l[0].advice.length > 10);
    assert.match(learnedSentence(l)!, /not template/);
  });

  it("does not learn from criteria that score well", () => {
    for (let i = 0; i < 3; i++) record(home, { asset: "poster", scores: all(5), average: 5, verdict: "ship" });
    assert.deepEqual(learnedFor(readJournal(home), "poster"), []);
  });

  it("clamps scores and ignores junk when recording", () => {
    record(home, { asset: "logo", scores: { "focal-point": 99, palette: Number.NaN, nope: 3 } as never, average: 0, verdict: "revise" });
    const e = readJournal(home).at(-1)!;
    assert.equal(e.scores["focal-point"], 5);
    assert.equal("palette" in e.scores, false);
    assert.equal("nope" in e.scores, false);
  });

  it("skips damaged lines and a missing journal", () => {
    const fresh = mkdtempSync(join(tmpdir(), "noapi-learn2-"));
    assert.deepEqual(readJournal(fresh), []);
    writeFileSync(journalPath(fresh), 'garbage\n{"asset":"hero","scores":{"palette":2},"average":2,"verdict":"revise","time":"x"}\n');
    assert.equal(readJournal(fresh).length, 1);
    rmSync(fresh, { recursive: true, force: true });
  });

  it("design_brief puts what was learned and the built-in lessons into every prompt", () => {
    const items = learnedFor(readJournal(home), "banner");
    const b = designBrief("banner", "a profile banner", {}, {}, { project: "Test", targetAspect: "3.2:1" }, { learned: learnedSentence(items), learnedItems: items, lessons: lessonsFor("banner") });
    assert.equal(b.learned.length, 1);
    for (const d of b.directions) {
      assert.match(d.prompt, /Earlier results of this kind fell short/);
      assert.match(d.prompt, /Rules learned from past results/);
      assert.match(d.prompt, /very wide \(3\.2:1\)/);
    }
  });
});

describe("preferredStyleFor", () => {
  const home2 = mkdtempSync(join(tmpdir(), "noapi-preferred-"));
  after(() => rmSync(home2, { recursive: true, force: true }));

  it("says nothing until there are enough shipped drafts", () => {
    record(home2, { asset: "hero", scores: all(5), average: 5, verdict: "ship", tier: "premium" });
    record(home2, { asset: "hero", scores: all(5), average: 5, verdict: "ship", tier: "premium" });
    assert.equal(preferredStyleFor(readJournal(home2), "hero"), undefined);
  });

  it("picks the tier and look that shipped most once there's a real majority", () => {
    record(home2, { asset: "hero", scores: all(5), average: 5, verdict: "ship", tier: "premium", look: "neon-glass" });
    const r = preferredStyleFor(readJournal(home2), "hero");
    assert.equal(r?.tier, "premium");
    assert.equal(r?.look, "neon-glass");
    assert.equal(r?.shipped, 3);
  });

  it("ignores revise and other asset types", () => {
    record(home2, { asset: "hero", scores: all(2), average: 2, verdict: "revise", tier: "minimal" });
    record(home2, { asset: "banner", scores: all(5), average: 5, verdict: "ship", tier: "minimal" });
    const r = preferredStyleFor(readJournal(home2), "hero");
    assert.equal(r?.tier, "premium");
  });

  it("refuses to pick a tier that is only a plurality, not a majority", () => {
    const home3 = mkdtempSync(join(tmpdir(), "noapi-preferred2-"));
    record(home3, { asset: "poster", scores: all(5), average: 5, verdict: "ship", tier: "premium" });
    record(home3, { asset: "poster", scores: all(5), average: 5, verdict: "ship", tier: "luxury" });
    record(home3, { asset: "poster", scores: all(5), average: 5, verdict: "ship", tier: "minimal" });
    assert.equal(preferredStyleFor(readJournal(home3), "poster"), undefined);
    rmSync(home3, { recursive: true, force: true });
  });
});

describe("aspect and lessons", () => {
  it("reads common aspect spellings", () => {
    assert.equal(parseAspect("16:9")?.toFixed(2), "1.78");
    assert.equal(parseAspect("3.2:1"), 3.2);
    assert.equal(parseAspect("2"), 2);
    assert.equal(parseAspect("wide"), undefined);
    assert.equal(parseAspect("0:5"), undefined);
  });

  it("a normal crop gets no wide warning", () => {
    const b = designBrief("hero", "a hero", {}, {}, { targetAspect: "16:9" });
    assert.doesNotMatch(b.directions[0].prompt, /very wide/);
  });

  it("lessons are limited, relevant and short", () => {
    const l = lessonsFor("banner", 3);
    assert.ok(l.length > 0 && l.length <= 3);
    assert.ok(lessonsFor("logo").every((x) => !/16:9|crop/.test(x)));
  });

  it("every built-in lesson is short enough to survive untruncated and ends as a sentence", () => {
    for (const l of LESSONS) {
      assert.ok(l.rule.length <= 190, l.rule);
      assert.match(l.rule, /[.]$/);
    }
  });

  it("advice never pushes a prompt past the size limit", () => {
    const base = "x".repeat(PROMPT_BUDGET - 100);
    const out = withAdvice(base, ["short advice.", "y".repeat(500)]);
    assert.ok(out.length <= PROMPT_BUDGET);
    assert.match(out, /short advice\./);
    assert.doesNotMatch(out, /yyy/);
  });

  it("a brief for any asset type with everything switched on stays under the 4000 character limit", () => {
    const learned = learnedSentence([{ criterion: "not-template", average: 2, seen: 4, advice: "Use a real detail from the project and one unusual composition choice." }]);
    for (const asset of ASSET_TYPES) {
      const b = designBrief(asset, "a long subject ".repeat(8), { colors: ["#00D1FF", "#006BFF", "#FF8A00", "#FF2E6D"], mood: "luxurious", audience: "security leaders" },
        { tier: "luxury", look: "neon-glass", theme: "dark" }, { project: "Test project", about: "A security tool for teams that care about detection and response.", usage: "a profile banner", goal: "look premium", targetAspect: "3.2:1", exactText: ["Hello"] },
        { learned, lessons: lessonsFor(asset) });
      for (const d of b.directions) assert.ok(d.prompt.length <= 4000, `${asset}: ${d.prompt.length}`);
    }
  });
});
