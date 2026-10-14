import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { codexExecArgs } from "../src/providers/codex.js";

describe("codex reference images", () => {
  it("puts the prompt before any -i, because --image takes many files and would swallow it", () => {
    const a = codexExecArgs("/w", "make an image", ["/p/ref.png", "/p/look.png"]);
    assert.equal(a.indexOf("make an image") < a.indexOf("-i"), true);
    assert.deepEqual(a.slice(a.indexOf("-i")), ["-i", "/p/ref.png", "-i", "/p/look.png"]);
  });

  it("adds no -i when there are no references", () => {
    assert.equal(codexExecArgs("/w", "task").includes("-i"), false);
  });
});
