import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AUDIT_RUBRIC, auditScores, designBrief, domainCues, thirdPartyRule } from "../src/design.js";

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
