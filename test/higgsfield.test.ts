import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { _test } from "../src/providers/higgsfield.js";

const { params, findUrls, findNumber } = _test;

describe("higgsfield argument building", () => {
  it("passes the prompt as one --prompt= argument, even if it starts with a dash", () => {
    assert.deepEqual(params("nano_banana_2", "-rf --wait", {}), ["nano_banana_2", "--prompt=-rf --wait"]);
  });

  it("rejects model names that look like flags or paths", () => {
    for (const m of ["--json", "-x", "../hf", "a b", "Model", "x;calc"]) assert.throws(() => params(m, "p", {}), m);
  });

  it("rejects parameter names that could inject flags", () => {
    assert.throws(() => params("kling3_0", "p", { "wait --json": 1 }));
    assert.throws(() => params("kling3_0", "p", { "X": 1 }));
  });

  it("drops empty values and formats key=value", () => {
    assert.deepEqual(params("kling3_0", "p", { aspect_ratio: "16:9", duration: undefined, mode: "" }), ["kling3_0", "--prompt=p", "--aspect_ratio=16:9"]);
  });
});

describe("higgsfield output parsing", () => {
  it("only picks https media links", () => {
    const urls = findUrls({
      a: "https://cdn.example.com/out.mp4?sig=1",
      b: "http://cdn.example.com/x.png",
      c: "https://example.com/page",
      d: [{ e: "https://cdn.example.com/y.webp" }],
      f: "file:///C:/x.png",
    });
    assert.deepEqual(urls, ["https://cdn.example.com/out.mp4?sig=1", "https://cdn.example.com/y.webp"]);
  });

  it("finds a nested credits number", () => {
    assert.equal(findNumber({ job: { estimate: { credits: 12 } } }, /credits?/i), 12);
    assert.equal(findNumber({ nothing: "here" }, /credits?/i), undefined);
  });
});
