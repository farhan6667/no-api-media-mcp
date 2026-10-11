import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AUDIT_RUBRIC, auditScores, designBrief, domainCues, missingContext, thirdPartyRule } from "../src/design.js";

const all = (n: number) => Object.fromEntries(AUDIT_RUBRIC.map((r) => [r.id, n]));

describe("design_audit scoring", () => {
  it("ships when the average is 4 or more and nothing is below 3", () => {
    const r = auditScores(all(4));
    assert.equal(r.verdict, "ship");
    assert.equal(r.average, 4);
    assert.deepEqual(r.fixes, []);
  });

  it("asks for a revision and names the weakest criteria with their fixes", () => {
    const r = auditScores({ ...all(5), thumbnail: 2, hierarchy: 3 });
    assert.equal(r.verdict, "revise");
    assert.deepEqual(r.weakest, ["thumbnail", "hierarchy"]);
    assert.ok(r.fixes.every((f) => f.fix.length > 10));
  });

  it("one very weak criterion blocks shipping even with a high average", () => {
    const r = auditScores({ ...all(5), "text-accuracy": 1 });
    assert.ok(r.average >= 4);
    assert.equal(r.verdict, "revise");
  });

  it("never treats a missing criterion as a pass", () => {
    const r = auditScores({ "focal-point": 5 });
    assert.equal(r.verdict, "revise");
    assert.equal(r.missing.length, AUDIT_RUBRIC.length - 1);
  });

  it("clamps out-of-range and ignores NaN scores", () => {
    const r = auditScores({ ...all(5), palette: 99, hierarchy: Number.NaN });
    assert.ok(r.missing.includes("hierarchy"));
    assert.equal(r.verdict, "revise");
  });
});

describe("domain cues and third-party names", () => {
  it("finds the security field from the project description", () => {
    const c = domainCues("Wazuh RuleGuard", "Test SIEM detection rule changes");
    assert.equal(c?.field, "cyber security");
    assert.match(c!.cues, /shield|terminal/);
  });

  it("returns nothing for an unrelated topic", () => {
    assert.equal(domainCues("A bakery", "sells bread"), undefined);
  });

  it("tells the model not to draw a third party's logo", () => {
    const r = thirdPartyRule("Wazuh RuleGuard");
    assert.match(r!, /Do not draw its logo/);
    assert.equal(thirdPartyRule("My own tool"), undefined);
  });

  it("design_brief carries the audit, the cues and the rule into its prompts", () => {
    const b = designBrief("banner", "tests detection rule changes", {}, {}, { project: "Wazuh RuleGuard", about: "Checks SIEM detections", exactText: ["RuleGuard"] });
    assert.equal(b.eye_catch_audit.criteria.length, AUDIT_RUBRIC.length);
    assert.equal(b.domain_cues?.field, "cyber security");
    assert.ok(b.third_party);
    assert.match(b.directions[0].prompt, /Make the field obvious without words/);
    assert.match(b.directions[0].prompt, /independent project/);
  });
});

describe("platform honesty critique", () => {
  it("asks the deceptive-content question for assets realistic enough to be mistaken for a real photo", () => {
    const b = designBrief("hero", "a team at work");
    assert.ok(b.critique.some((c) => /mistaken for a real photo/.test(c)));
  });

  it("skips the question for a flat logo or app icon, which can't pass as a real photo", () => {
    const logo = designBrief("logo", "a shield mark");
    const icon = designBrief("app-icon", "a shield mark");
    assert.ok(!logo.critique.some((c) => /mistaken for a real photo/.test(c)));
    assert.ok(!icon.critique.some((c) => /mistaken for a real photo/.test(c)));
  });
});

describe("alt text suggestion", () => {
  it("gives a labelled starting template, not a fabricated description", () => {
    const b = designBrief("hero", "a calm workspace", {}, {}, { project: "Acme" });
    assert.match(b.alt_text_suggestion, /^Acme: a hero image of a calm workspace\./);
    assert.match(b.alt_text_suggestion, /template, not a description/);
  });
});

describe("texture and environment-map asset types", () => {
  it("texture prompts ask for a seamless tile and nothing else to look at", () => {
    const b = designBrief("texture", "brushed steel");
    assert.match(b.directions[0].prompt, /[Ss]eamless tileable/);
    assert.ok(b.critique.some((c) => /tile seamlessly/.test(c)));
    assert.equal(b.recommended.aspect, "1:1");
  });

  it("environment-map prompts ask for a 2:1 equirectangular wrap with no seam", () => {
    const b = designBrief("environment-map", "a calm studio dome");
    for (const d of b.directions) {
      assert.match(d.prompt, /[Ee]quirectangular/);
      assert.match(d.prompt, /2:1/);
    }
    assert.ok(b.critique.some((c) => /left edge join the right edge/.test(c)));
    assert.equal(b.recommended.aspect, "2:1");
    assert.match(b.recommended.provider, /codex only/);
  });

  it("neither asset type gets the real-photo honesty question (they're technical maps, not scenes)", () => {
    const texture = designBrief("texture", "x");
    const env = designBrief("environment-map", "x");
    assert.ok(!texture.critique.some((c) => /mistaken for a real photo/.test(c)));
    assert.ok(!env.critique.some((c) => /mistaken for a real photo/.test(c)));
  });

  it("both get a sensible alt text template", () => {
    const texture = designBrief("texture", "brushed steel", {}, {}, { project: "Acme" });
    assert.match(texture.alt_text_suggestion, /^Acme: a tileable texture of brushed steel\./);
  });
});

describe("preferred style from the learning journal", () => {
  it("is carried through unapplied when the caller already set their own tier", () => {
    const b = designBrief("hero", "x", {}, { tier: "minimal" }, {}, { preferredStyle: { tier: "premium", shipped: 5 } });
    assert.equal(b.style.tier, "minimal");
    assert.equal(b.preferred_style?.applied, false);
  });

  it("is applied as the default tier when the caller left it unset", () => {
    const b = designBrief("hero", "x", {}, {}, {}, { preferredStyle: { tier: "luxury", look: "luxury-gold", shipped: 4 } });
    assert.equal(b.style.tier, "luxury");
    assert.equal(b.style.look, "luxury-gold");
    assert.equal(b.preferred_style?.applied, true);
  });

  it("ignores a garbled tier or look name rather than crashing", () => {
    const b = designBrief("hero", "x", {}, {}, {}, { preferredStyle: { tier: "not-a-real-tier", shipped: 4 } });
    assert.equal(b.style.tier, "premium");
  });
});

describe("needs_from_user", () => {
  it("asks where it goes and what it goes with when neither is known", () => {
    const q = designBrief("hero", "x").needs_from_user!;
    assert.equal(q.length, 3);
    assert.match(q[0], /Where will this be used/);
    assert.match(q[1], /What post, page or story/);
  });
  it("asks nothing once usage and the story are given", () => {
    assert.equal(missingContext({ usage: "a LinkedIn feed post", goal: "explain shadow AI" }), undefined);
  });
  it("a target crop counts as knowing where it goes, and project.about as knowing the story", () => {
    assert.equal(missingContext({ targetAspect: "1200:627", about: "A security tool." }), undefined);
  });
});
