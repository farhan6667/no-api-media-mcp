import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveShareBrowser } from "../src/config.js";

describe("share_browser setting", () => {
  it("is on by default, since it runs on the user's own machine", () => {
    assert.equal(resolveShareBrowser({}, {}), true);
  });
  it("can be turned off in config.json for a shared machine", () => {
    assert.equal(resolveShareBrowser({ share_browser: false }, {}), false);
    assert.equal(resolveShareBrowser({ share_browser: "false" }, {}), false);
  });
  it("the environment wins over config.json, both ways", () => {
    assert.equal(resolveShareBrowser({ share_browser: true }, { NOAPI_SHARE_BROWSER: "0" }), false);
    assert.equal(resolveShareBrowser({ share_browser: false }, { NOAPI_SHARE_BROWSER: "1" }), true);
  });
});

describe("browser sharing is gated on the setting in the code", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "browser.ts"), "utf8");
  it("the devtools port is only added when share_browser is on", () => {
    assert.match(src, /if \(this\.cfg\.shareBrowser\) args\.push\("--remote-debugging-port=0"\)/);
  });
  it("only connects to an existing browser over CDP when sharing is on", () => {
    assert.match(src, /if \(this\.cfg\.shareBrowser && this\.profileLocked\(\)\)/);
  });
  it("only connects on loopback, and only to the browser that wrote our profile's DevToolsActivePort", () => {
    assert.match(src, /fetch\(`http:\/\/127\.0\.0\.1:\$\{ep\.port\}\/json\/version`/);
    assert.match(src, /ws\.startsWith\(`ws:\/\/127\.0\.0\.1:\$\{ep\.port\}\/`\) \|\| !ws\.endsWith\(ep\.wsPath\)/);
  });
});
