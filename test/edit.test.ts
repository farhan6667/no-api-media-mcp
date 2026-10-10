import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { designBrief, LOOKS } from "../src/design.js";
import { SOCIAL_PRESETS } from "../src/edit.js";
import { withFileOnlyInputs } from "../src/optimize.js";

describe("ffmpeg input guard", () => {
  it("adds a file-only protocol whitelist to every real input", () => {
    assert.deepEqual(withFileOnlyInputs(["-y", "-i", "a.mp4", "-i", "b.png", "out.mp4"]), [
      "-y", "-protocol_whitelist", "file", "-i", "a.mp4", "-protocol_whitelist", "file", "-i", "b.png", "out.mp4",
    ]);
  });
  it("leaves generated lavfi sources alone (they read no files or URLs)", () => {
    assert.deepEqual(withFileOnlyInputs(["-f", "lavfi", "-i", "color=c=black:s=10x10"]), ["-f", "lavfi", "-i", "color=c=black:s=10x10"]);
  });
  it("doesn't double-add", () => {
    const once = withFileOnlyInputs(["-i", "a.mp4"]);
    assert.deepEqual(withFileOnlyInputs(once), once);
  });
});

describe("text overlays can't inject ffmpeg filter options", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "edit.ts"), "utf8");
  it("user text goes through a file, never into the filter string", () => {
    assert.match(src, /textfile=text\.txt/);
    assert.doesNotMatch(src, /drawtext=[^`]*\$\{op\.text\}/);
  });
  it("drawtext expansion is off, so %{...} in text can't call ffmpeg functions", () => {
    assert.match(src, /expansion=none/);
  });
  it("subtitles are copied to a private folder under a fixed name", () => {
    assert.match(src, /copyFileSync\(op\.srt, join\(dir, "subs\.srt"\)\)/);
  });
});

describe("social size presets", () => {
  it("have the sizes the platforms document", () => {
    assert.deepEqual([SOCIAL_PRESETS["og-1200x630"].w, SOCIAL_PRESETS["og-1200x630"].h], [1200, 630]);
    assert.deepEqual([SOCIAL_PRESETS["story-1080x1920"].w, SOCIAL_PRESETS["story-1080x1920"].h], [1080, 1920]);
    assert.deepEqual([SOCIAL_PRESETS["github-social-1280x640"].w, SOCIAL_PRESETS["github-social-1280x640"].h], [1280, 640]);
  });
  it("icons are PNG so they stay crisp and transparent", () => {
    for (const k of ["favicon-32", "apple-touch-180", "icon-512"] as const) assert.equal(SOCIAL_PRESETS[k].ext, ".png");
  });
  it("cover other platforms the user asked for: Facebook, YouTube, X and TikTok", () => {
    assert.deepEqual([SOCIAL_PRESETS["facebook-cover-820x312"].w, SOCIAL_PRESETS["facebook-cover-820x312"].h], [820, 312]);
    assert.deepEqual([SOCIAL_PRESETS["youtube-banner-2560x1440"].w, SOCIAL_PRESETS["youtube-banner-2560x1440"].h], [2560, 1440]);
    assert.deepEqual([SOCIAL_PRESETS["x-header-1500x500"].w, SOCIAL_PRESETS["x-header-1500x500"].h], [1500, 500]);
    assert.deepEqual([SOCIAL_PRESETS["tiktok-profile-200x200"].w, SOCIAL_PRESETS["tiktok-profile-200x200"].h], [200, 200]);
  });
});

describe("creative briefs", () => {
  it("default to premium and read like a brief, not a keyword list", () => {
    const b = designBrief("hero", "a calm workspace", { name: "Acme" }, {}, { about: "Acme makes desk lamps.", usage: "the landing page hero" });
    const p = b.directions[0].prompt;
    assert.equal(b.style.tier, "premium");
    assert.match(p, /^I'm making a hero image for Acme\. Acme makes desk lamps\./);
    assert.match(p, /the landing page hero/);
    assert.doesNotMatch(p, /Avoid:/);
    assert.doesNotMatch(p, /strict palette/);
  });
  it("carry a named look", () => {
    const p = designBrief("poster", "a launch", {}, { look: "neon-glass" }).directions[0].prompt;
    assert.ok(p.includes(LOOKS["neon-glass"]));
  });
  it("only put words in designs that are meant to have them", () => {
    const hero = designBrief("hero", "x").directions[0].prompt;
    const poster = designBrief("poster", "x", {}, {}, { exactText: ["Hello World"] }).directions[0].prompt;
    assert.match(hero, /Don't put any words/);
    assert.match(poster, /exactly this text.*"Hello World"/);
  });
});
