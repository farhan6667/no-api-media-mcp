import { test } from "node:test";
import assert from "node:assert/strict";
import { browserCandidates, browserName } from "../src/config.js";
import { staleLogin } from "../src/providers/codex.js";
import { newestNew } from "../src/providers/chatgpt.js";

// Issue #12: Brave and Edge are found when Chrome is missing, Chrome stays first.
test("browser candidates try Chrome, then Brave, then Edge on Windows", () => {
  const list = browserCandidates("win32", { PROGRAMFILES: "C:\\PF", "PROGRAMFILES(X86)": "C:\\PF86", LOCALAPPDATA: "C:\\LA" });
  const first = (word: string) => list.findIndex((p) => p.toLowerCase().includes(word));
  assert.ok(first("chrome.exe") >= 0 && first("brave.exe") > first("chrome.exe") && first("msedge.exe") > first("brave.exe"));
  assert.ok(list.every((p) => p.length > 0), "no empty path when LOCALAPPDATA is set");
  assert.ok(browserCandidates("win32", {}).every((p) => p.length > 0), "an unset LOCALAPPDATA adds no relative path");
});

test("browser names for status output", () => {
  assert.equal(browserName("C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"), "Brave");
  assert.equal(browserName("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"), "Edge");
  assert.equal(browserName("/usr/bin/google-chrome"), "Chrome");
  assert.equal(browserName(""), "none");
});

// Issue #11: a refused run outranks the CLI's local "Logged in" until the login file is renewed.
test("a refused Codex run marks the login stale until a newer codex login", () => {
  assert.equal(staleLogin(0, 1000), false, "no refusal recorded");
  assert.equal(staleLogin(2000, 1000), true, "refused after the last login");
  assert.equal(staleLogin(2000, 3000), false, "logged in again afterwards");
  assert.equal(staleLogin(2000, undefined), true, "no login file at all");
});

// Issue #10: an image already on the page is never taken as the new answer.
test("only an image that appeared after sending counts", () => {
  const old = "https://chatgpt.com/backend/old.png";
  assert.equal(newestNew([old], [old]), "", "the old image alone is not an answer");
  assert.equal(newestNew([old, "https://x/new.png"], [old]), "https://x/new.png");
  assert.equal(newestNew(["https://x/a.png", old, "https://x/b.png"], [old]), "https://x/b.png");
  assert.equal(newestNew([], []), "");
});
