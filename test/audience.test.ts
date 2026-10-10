import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AUDIENCE_PERSONAS, matchPersona } from "../src/audience.js";
import { designBrief } from "../src/design.js";

describe("matchPersona", () => {
  it("finds the right persona from free text", () => {
    assert.equal(matchPersona("security hiring managers and CISOs")?.id, "executive");
    assert.equal(matchPersona("a technical audience of developers")?.id, "developer");
    assert.equal(matchPersona("GitHub visitors and open source contributors")?.id, "open-source-community");
    assert.equal(matchPersona("SOC analysts and pentesters")?.id, "security-practitioner");
    assert.equal(matchPersona("gamers and the general public")?.id, "consumer");
  });

  it("returns nothing for unrelated or empty text", () => {
    assert.equal(matchPersona("a bakery's regular customers"), undefined);
    assert.equal(matchPersona(undefined, undefined), undefined);
    assert.equal(matchPersona(""), undefined);
  });

  it("every persona has a non-empty tone and critique", () => {
    for (const p of AUDIENCE_PERSONAS) {
      assert.ok(p.tone.length > 10, p.id);
      assert.ok(p.critique.length > 10, p.id);
      assert.match(p.critique, /\?$/, p.id);
    }
  });
});

describe("designBrief with an audience persona", () => {
  it("adds the persona's tone and critique question, and reports which persona matched", () => {
    const b = designBrief("hero", "a security tool", {}, {}, { audience: "CISOs and security hiring managers" }) as { audience_persona?: { id: string }; critique: string[]; directions: { prompt: string }[] };
    assert.equal(b.audience_persona?.id, "executive");
    assert.ok(b.critique.some((c) => /time-pressed executive/.test(c)));
    assert.match(b.directions[0].prompt, /time-pressed reader/);
  });

  it("uses the persona's tier only when the caller didn't set one", () => {
    const withPersona = designBrief("hero", "x", {}, {}, { audience: "developers" });
    assert.equal(withPersona.style.tier, "minimal");
    const explicitTier = designBrief("hero", "x", {}, { tier: "luxury" }, { audience: "developers" });
    assert.equal(explicitTier.style.tier, "luxury");
  });

  it("uses the persona's palette only when neither the caller nor a domain cue supplied one", () => {
    const personaOnly = designBrief("hero", "a general tool", {}, {}, { audience: "gamers and consumers" });
    assert.match(personaOnly.directions[0].prompt, /#39FF14/);
    const explicitColors = designBrief("hero", "a general tool", { colors: ["#000000"] }, {}, { audience: "gamers and consumers" });
    assert.doesNotMatch(explicitColors.directions[0].prompt, /#39FF14/);
    const domainWins = designBrief("hero", "a cyber security tool", {}, {}, { audience: "gamers and consumers" });
    assert.doesNotMatch(domainWins.directions[0].prompt, /#39FF14/);
  });

  it("without any matching audience text, no persona is reported and nothing breaks", () => {
    const b = designBrief("hero", "a tool", {}, {}, {}) as { audience_persona?: unknown };
    assert.equal(b.audience_persona, undefined);
  });

  it("a persona on a logo brief still adjusts tier, but logos still carry no typography suggestion", () => {
    const b = designBrief("logo", "a mark", {}, {}, { audience: "developers" }) as { typography?: unknown; style: { tier?: string } };
    assert.equal(b.style.tier, "minimal");
    assert.equal(b.typography, undefined);
  });
});
