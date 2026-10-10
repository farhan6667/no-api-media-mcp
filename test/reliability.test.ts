import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { classifyFailure, providerHealth, readReliability, recordProviderOutcome, reliabilityPath } from "../src/reliability.js";

const home = mkdtempSync(join(tmpdir(), "noapi-reliability-"));
after(() => rmSync(home, { recursive: true, force: true }));

describe("classifyFailure", () => {
  const cases: [string, string][] = [
    ["Codex is not signed in. Run in a terminal: codex login", "login"],
    ["Your ChatGPT plan's Codex limit is used up for now", "quota"],
    ["rate limit exceeded, try again later", "quota"],
    ["Codex timed out", "timeout"],
    ["locator.click: Timeout 30000ms exceeded waiting for selector", "timeout"],
    ["could not find the send button on the page", "selector"],
    ["fetch failed: ENOTFOUND flow.google.com", "network"],
    ["the model refused the request for an unrelated reason", "other"],
  ];
  for (const [message, expected] of cases) {
    it(`classifies "${message.slice(0, 40)}..." as ${expected}`, () => assert.equal(classifyFailure(message), expected));
  }
});

describe("recordProviderOutcome and readReliability", () => {
  it("records a success with no error detail", () => {
    recordProviderOutcome(home, "codex", true);
    const last = readReliability(home).at(-1)!;
    assert.equal(last.provider, "codex");
    assert.equal(last.ok, true);
    assert.equal(last.cls, undefined);
    assert.equal(last.note, undefined);
  });

  it("records a failure with its class and a redacted, truncated message", () => {
    recordProviderOutcome(home, "flow", false, "selector", `could not find button, user j***@gmail.com token=${"x".repeat(500)}`);
    const last = readReliability(home).at(-1)!;
    assert.equal(last.ok, false);
    assert.equal(last.cls, "selector");
    assert.ok(last.note!.length <= 300);
  });

  it("never throws, even with a hostile home path, and skips damaged lines", () => {
    assert.doesNotThrow(() => recordProviderOutcome("\0bad", "codex", true));
    const f = reliabilityPath(home);
    writeFileSync(f, readFileSync(f, "utf8") + "not json\n{}\n");
    const events = readReliability(home);
    assert.ok(events.every((e) => typeof e.provider === "string"));
  });
});

describe("providerHealth", () => {
  const ev = (provider: string, ok: boolean, cls?: "selector" | "login") => ({ time: new Date().toISOString(), provider, ok, cls });

  it("says nothing for an isolated failure", () => {
    const events = [ev("gemini", true), ev("gemini", false, "timeout" as never), ev("gemini", true)];
    assert.equal(providerHealth(events, "gemini").note, undefined);
  });

  it("flags a real streak of the same failure class", () => {
    const events = [ev("flow", false, "selector"), ev("flow", false, "selector"), ev("flow", false, "selector")];
    const h = providerHealth(events, "flow");
    assert.equal(h.streak, 3);
    assert.match(h.note!, /flow has failed its last 3 calls/);
    assert.match(h.note!, /selector/);
  });

  it("a streak broken by a different failure class resets", () => {
    const events = [ev("flow", false, "login"), ev("flow", false, "selector"), ev("flow", false, "selector")];
    assert.equal(providerHealth(events, "flow").streak, 2);
  });

  it("a success breaks the streak", () => {
    const events = [ev("flow", false, "selector"), ev("flow", true), ev("flow", false, "selector")];
    assert.equal(providerHealth(events, "flow").streak, 1);
  });

  it("only looks at the named provider's own events", () => {
    const events = [ev("flow", false, "selector"), ev("codex", false, "selector"), ev("codex", false, "selector")];
    assert.equal(providerHealth(events, "flow").streak, 1);
  });
});
