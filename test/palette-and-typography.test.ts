import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { designBrief, LOOKS } from "../src/design.js";

describe("curated palette fallback", () => {
  it("fills brand.colors from a curated palette when the caller supplies none", () => {
    const b = designBrief("hero", "a tool for penetration testing and detection engineering", {}, {}, { project: "RuleGuard" });
    assert.ok(b.directions[0].prompt.includes("#00D1FF"));
  });

  it("never overrides colours the caller actually supplied", () => {
    const b = designBrief("hero", "a cyber security tool", { colors: ["#111111", "#222222"] }, {}, {});
    assert.ok(b.directions[0].prompt.includes("#111111"));
    assert.ok(!b.directions[0].prompt.includes("#00D1FF"));
  });

  it("has no curated palette for an unmatched subject, and the brief still works", () => {
    const b = designBrief("hero", "a bakery website", {}, {}, {});
    assert.equal(b.directions.length, 3);
  });
});

describe("typography suggestion", () => {
  it("returns a real heading/body pairing with a loadable Google Fonts URL", () => {
    const b = designBrief("banner", "a cyber security tool", {}, {}, { project: "RuleGuard" }) as { typography?: { heading: string; body: string; googleFontsUrl: string; note: string } };
    assert.equal(b.typography?.heading, "Space Grotesk");
    assert.equal(b.typography?.body, "DM Sans");
    assert.match(b.typography!.googleFontsUrl, /^https:\/\/fonts\.googleapis\.com\/css2\?family=/);
    assert.match(b.typography!.note, /composite/);
  });

  it("logos don't get a typography suggestion, logos carry no text", () => {
    const b = designBrief("logo", "a mark for a security tool", {}, {}, {}) as { typography?: unknown };
    assert.equal(b.typography, undefined);
  });

  it("falls back to a sensible pairing for a subject with no domain match", () => {
    const b = designBrief("hero", "a bakery website", {}, {}, {}) as { typography?: { heading: string } };
    assert.equal(b.typography?.heading, "Space Grotesk");
  });
});

describe("cyber-matrix look", () => {
  it("is a real, distinct named look", () => {
    assert.ok("cyber-matrix" in LOOKS);
    assert.match(LOOKS["cyber-matrix"], /signal-green/);
    assert.notEqual(LOOKS["cyber-matrix"], LOOKS["neon-glass"]);
  });

  it("can be requested by name in a brief", () => {
    const b = designBrief("hero", "a security tool", {}, { look: "cyber-matrix" }, {});
    assert.match(b.directions[0].prompt, /signal-green/);
  });
});
