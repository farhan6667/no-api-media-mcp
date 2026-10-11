import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveShareBrowser } from "../src/config.js";

describe("share_browser setting", () => {
  it("is off by default, because it opens a local devtools port", () => {
    assert.equal(resolveShareBrowser({}, {}), false);
  });
  it("can be turned on in config.json", () => {
    assert.equal(resolveShareBrowser({ share_browser: true }, {}), true);
    assert.equal(resolveShareBrowser({ share_browser: "true" }, {}), true);
  });
  it("the environment wins over config.json, both ways", () => {
    assert.equal(resolveShareBrowser({ share_browser: true }, { NOAPI_SHARE_BROWSER: "0" }), false);
    assert.equal(resolveShareBrowser({ share_browser: false }, { NOAPI_SHARE_BROWSER: "1" }), true);
  });
});

describe("browser sharing stays opt-in in the code", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "browser.ts"), "utf8");
  it("the devtools port is only added when share_browser is on", () => {
    assert.match(src, /if \(this\.cfg\.shareBrowser\) args\.push\("--remote-debugging-port=0"\)/);
  });
  it("only connects to an existing browser over CDP when sharing is on", () => {
    assert.match(src, /if \(this\.cfg\.shareBrowser && this\.profileLocked\(\)\)/);
  });
  it("only connects on loopback", () => {
    assert.match(src, /connectOverCDP\(`http:\/\/127\.0\.0\.1:\$\{port\}`/);
  });
});
