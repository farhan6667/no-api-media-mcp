import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { cropWithout, findEmptyBands } from "../src/composition.js";
import { designBrief, spaceAdvice } from "../src/design.js";
import { feedbackFor, readFeedback, recordFeedback } from "../src/feedback.js";
import { COMPOSITING_RULES } from "../src/lessons.js";

const home = mkdtempSync(join(tmpdir(), "noapi-feedback-"));
after(() => rmSync(home, { recursive: true, force: true }));

describe("design_feedback journal", () => {
  it("records a correction and brings it back for that asset type", () => {
    recordFeedback(home, { asset: "social-post", problem: "an empty navy band across the top", instead: "fill the frame and crop to the content", scope: "image" });
    recordFeedback(home, { asset: "all", problem: "company logo on a personal post", instead: "use the person's own SFA mark", scope: "compositing" });
    const f = feedbackFor(readFeedback(home), "social-post");
    assert.equal(f.image.length, 1);
    assert.match(f.image[0], /^fill the frame and crop to the content\.$/, "the image model only hears the positive instruction");
    assert.equal(f.compositing.length, 1);
    assert.match(f.compositing[0], /SFA mark/);
  });

  it("an 'all' correction reaches every asset type, a specific one doesn't leak to others", () => {
    const f = feedbackFor(readFeedback(home), "hero");
    assert.equal(f.image.length, 0);
    assert.equal(f.compositing.length, 1);
  });

  it("keeps only the newest copy of a repeated problem", () => {
    recordFeedback(home, { asset: "social-post", problem: "An empty navy band across the top!", instead: "crop it tight", scope: "image" });
    const f = feedbackFor(readFeedback(home), "social-post");
    assert.equal(f.image.length, 1);
    assert.match(f.image[0], /crop it tight/);
  });

  it("refuses empty text and redacts what it stores", () => {
    assert.equal(recordFeedback(home, { asset: "all", problem: "   ", instead: "x", scope: "both" }), undefined);
    const e = recordFeedback(home, { asset: "all", problem: "logo looked off, see j.doe@example.com", instead: "use the real file", scope: "both" })!;
    assert.doesNotMatch(e.problem, /j\.doe@example\.com/);
  });

  it("design_brief puts image corrections in the prompt and compositing ones in compositing_rules", () => {
    const fb = feedbackFor(readFeedback(home), "social-post");
    const b = designBrief("social-post", "shadow AI", { name: "SFA" }, {}, { usage: "LinkedIn feed", goal: "explain it" }, { userFeedback: fb });
    assert.match(b.directions[0].prompt, /This user asked for, from earlier results: .*crop it tight\./);
    assert.doesNotMatch(b.directions[0].prompt, /empty navy band/);
    assert.ok(b.compositing_rules!.from_this_user.some((r) => /SFA mark/.test(r)));
    assert.deepEqual(b.compositing_rules!.built_in, COMPOSITING_RULES);
  });
});

describe("empty space is asked for only when text will really go there", () => {
  it("no overlay text: asks for a full frame", () => {
    assert.match(spaceAdvice("social-post", {})!, /fill the frame edge to edge/);
  });
  it("overlay text: asks for one calm zone sized for it, without drawing it", () => {
    const a = spaceAdvice("banner", { overlayText: ["Shadow AI"] })!;
    assert.match(a, /calm, low-detail zone/);
    assert.match(a, /"Shadow AI"/);
    assert.match(a, /Don't draw the words/);
  });
  it("a hero keeps one calm side for the HTML headline; model-drawn text is left alone", () => {
    assert.match(spaceAdvice("hero", {})!, /keep one side calm/);
    assert.equal(spaceAdvice("banner", { exactText: ["Hello"] }), undefined);
  });
  it("the banner Scene prompt no longer asks for an empty sky", () => {
    const b = designBrief("banner", "a calm valley");
    assert.doesNotMatch(b.directions.find((d) => d.name === "Scene")!.prompt, /empty area for text|large sky/);
  });
  it("the brief asks whose logo goes on a public asset when no brand is given", () => {
    const q = designBrief("social-post", "x", {}, {}, { usage: "LinkedIn", goal: "y" }).needs_from_user!;
    assert.equal(q.length, 1);
    assert.match(q[0], /Who publishes this/);
  });
});

describe("findEmptyBands", () => {
  const W = 40;
  const H = 40;
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % 256);
  const img = (flatTopRows = 0, flatLeftCols = 0) => {
    const a = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = y < flatTopRows || x < flatLeftCols ? 12 : noise();
    return a;
  };
  it("a busy image has no band", () => {
    assert.deepEqual(findEmptyBands(img(), W, H), []);
  });
  it("finds a flat strip at the top and says how big it is", () => {
    assert.deepEqual(findEmptyBands(img(12), W, H), [{ edge: "top", share: 0.3 }]);
  });
  it("finds a flat strip on the left", () => {
    assert.deepEqual(findEmptyBands(img(0, 10), W, H), [{ edge: "left", share: 0.25 }]);
  });
  it("ignores a sliver under 10% of the frame", () => {
    assert.deepEqual(findEmptyBands(img(3), W, H), []);
  });
  it("a frame that's flat everywhere is a plain image, not a band", () => {
    assert.deepEqual(findEmptyBands(new Uint8Array(W * H).fill(30), W, H), []);
  });
});

describe("cropWithout", () => {
  it("removes most of the band, keeps a little margin, and stays even", () => {
    const c = cropWithout([{ edge: "top", share: 0.3 }], 1672, 941)!;
    assert.equal(c.x, 0);
    assert.equal(c.y, Math.floor(0.3 * 0.85 * 941));
    assert.equal(c.width % 2, 0);
    assert.equal(c.height % 2, 0);
    assert.ok(c.y + c.height <= 941);
  });
  it("nothing to crop when there's no band", () => {
    assert.equal(cropWithout([], 100, 100), undefined);
  });
});

describe("craft rules from published guides", () => {
  it("every rule is short, a full sentence, and has an https source", async () => {
    const { CRAFT_RULES } = await import("../src/lessons.js");
    assert.ok(CRAFT_RULES.length >= 15);
    for (const c of CRAFT_RULES) {
      assert.ok(c.rule.length <= 190, c.rule);
      assert.match(c.rule, /\.$/);
      assert.ok(c.source.length && c.source.every((s) => s.startsWith("https://")), c.rule);
    }
  });
  it("design_brief carries two craft rules in the prompt and more as notes", () => {
    const b = designBrief("product-video", "a smartwatch");
    assert.match(b.directions[0].prompt, /Craft: /);
    assert.ok(b.craft_notes.length > 2);
    assert.ok(b.craft_notes.some((n) => /camera move/.test(n)));
  });
  it("no compositing rule recommends the glow or the eyebrow label that read as cheap", () => {
    for (const r of COMPOSITING_RULES) assert.doesNotMatch(r, /add (a )?glow|use an eyebrow/i);
  });
});

describe("feedback scope, brand and forgetting", () => {
  const h = mkdtempSync(join(tmpdir(), "noapi-fb2-"));
  after(() => rmSync(h, { recursive: true, force: true }));
  it("guesses compositing for logo and text corrections, image otherwise", async () => {
    const { inferScope } = await import("../src/feedback.js");
    assert.equal(inferScope("the company logo on a personal post", "use the SFA mark"), "compositing");
    assert.equal(inferScope("headline glowed", "a scrim instead"), "compositing");
    assert.equal(inferScope("an empty band at the top", "fill the frame"), "image");
  });
  it("a brand-specific correction never applies to another brand", () => {
    recordFeedback(h, { asset: "all", problem: "company logo on his personal post", instead: "use the SFA mark", brand: "SFA" });
    assert.equal(feedbackFor(readFeedback(h), "social-post", "SFA").compositing.length, 1);
    assert.equal(feedbackFor(readFeedback(h), "social-post", "NexaForge").compositing.length, 0);
    assert.equal(feedbackFor(readFeedback(h), "social-post").compositing.length, 0);
  });
  it("forget removes exactly one entry", async () => {
    const { forgetFeedback } = await import("../src/feedback.js");
    const e = recordFeedback(h, { asset: "banner", problem: "too dark", instead: "lift the shadows" })!;
    assert.equal(forgetFeedback(h, e.time), true);
    assert.equal(readFeedback(h).some((x) => x.time === e.time), false);
    assert.equal(forgetFeedback(h, "nope"), false);
  });
});

describe("audience persona: the most specific match wins", () => {
  it("security engineers and analysts land on the security practitioner, not the developer", async () => {
    const { matchPersona } = await import("../src/audience.js");
    assert.equal(matchPersona("security engineers")?.id, "security-practitioner");
    assert.equal(matchPersona("security analysts and developers")?.id, "security-practitioner");
    assert.equal(matchPersona("developers")?.id, "developer");
  });
});

describe("prompt linter", () => {
  it("flags the clashes that caused the empty band and the model-drawn text", async () => {
    const { lintPrompt } = await import("../src/design.js");
    assert.ok(lintPrompt("Leave an empty area for text at the top. Fill the frame edge to edge.").length);
    assert.ok(lintPrompt("No text. Keep any text short and spell it correctly.").length);
    assert.ok(lintPrompt("A poster with the logo large at the top.").length);
    assert.deepEqual(lintPrompt("A calm valley at dusk, fills the frame. Don't put any words, letters or logos in the image."), []);
  });
  it("no generated brief clashes, across every asset type, crop and text option", async () => {
    const { ASSET_TYPES, designBrief } = await import("../src/design.js");
    const contexts = [{}, { targetAspect: "3.2:1" }, { overlayText: ["Shadow AI"] }, { exactText: ["Hello"] }, { targetAspect: "4:5", overlayText: ["Launch"] }];
    for (const asset of ASSET_TYPES) {
      for (const ctx of contexts) {
        const b = designBrief(asset, "a test subject", { name: "Acme", publisher: "company" }, {}, { usage: "a feed post", goal: "test", ...ctx });
        assert.equal(b.prompt_warnings, undefined, `${asset} ${JSON.stringify(ctx)}: ${b.prompt_warnings}`);
      }
    }
  });
});

describe("brand profiles", () => {
  const h = mkdtempSync(join(tmpdir(), "noapi-brand-"));
  after(() => rmSync(h, { recursive: true, force: true }));
  it("saves, lists, merges under explicit values, and removes", async () => {
    const { getBrand, mergeBrand, readBrands, removeBrand, saveBrand } = await import("../src/brands.js");
    saveBrand(h, { id: "sfa", name: "SFA", publisher: "person", colors: ["#1E90FF"] });
    assert.equal(readBrands(h).length, 1);
    const merged = mergeBrand(getBrand(h, "sfa"), { colors: ["#000000"] });
    assert.equal(merged.publisher, "person");
    assert.equal(merged.name, "SFA");
    assert.deepEqual(merged.colors, ["#000000"], "an explicit palette wins over the profile");
    assert.equal(removeBrand(h, "sfa"), true);
    assert.equal(readBrands(h).length, 0);
  });
  it("rejects a bad id and a logo file that doesn't exist", async () => {
    const { saveBrand } = await import("../src/brands.js");
    assert.throws(() => saveBrand(h, { id: "Bad Id", name: "x", publisher: "company" }));
    assert.throws(() => saveBrand(h, { id: "x", name: "x", publisher: "company", logo: { dark: join(h, "missing.png") } }));
  });
  it("with a publisher set, the brief stops asking whose logo it is", () => {
    const q = designBrief("social-post", "x", { name: "SFA", publisher: "person" }, {}, { usage: "LinkedIn", goal: "y" }).needs_from_user;
    assert.equal(q, undefined);
  });
});

describe("Flow model picking by family", () => {
  it("picks the newest full Nano Banana when the old name is gone", async () => {
    const { pickModelLabel } = await import("../src/providers/google.js");
    const menu = ["\u{1F34C} Nano Banana Pro", "Nano Banana 3", "Nano Banana 3 Lite", "Imagen 4", "Veo 3.1 - Fast", "Veo 3.1 - Quality", "Veo 4 - Fast"];
    assert.equal(pickModelLabel(menu, "nano-banana-2"), "Nano Banana 3");
    assert.equal(pickModelLabel(menu, "veo-fast"), "Veo 4 - Fast");
    assert.equal(pickModelLabel(menu, "veo-quality"), "Veo 3.1 - Quality");
    assert.equal(pickModelLabel(menu, "veo-lite"), undefined);
  });
  it("falls back to a Lite model only when it's the only one, and honours a pinned label", async () => {
    const { pickModelLabel } = await import("../src/providers/google.js");
    assert.equal(pickModelLabel(["Nano Banana 2 Lite"], "nano-banana-2"), "Nano Banana 2 Lite");
    assert.equal(pickModelLabel(["Nano Banana 3", "Nano Banana Pro"], "nano-banana-2", "pro"), "Nano Banana Pro");
    assert.equal(pickModelLabel(["Imagen 4"], "nano-banana-2"), undefined);
  });
  it("an aspect Flow doesn't have fails loudly instead of being skipped", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "providers", "google.ts"), "utf8");
    assert.doesNotMatch(src, /name: aspect \}\)\.click\(\)\.catch/);
    assert.match(src, /Flow doesn't offer the \$\{aspect\} aspect/);
  });
});

describe("parallel sessions don't share one Flow project", () => {
  it("only the lock owner writes the shared project; others keep their own", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "index.ts"), "utf8");
    assert.doesNotMatch(src, /project: readState\(cfg\)\.flowProject/);
    assert.equal(src.match(/writeState\(cfg, \{ flowProject/g)?.length, 1, "only keepFlowProject writes the shared project");
    assert.match(src, /if \(owner === process\.pid\) writeState\(cfg, \{ flowProject: url \}\)/);
  });
});

describe("output formats", () => {
  it("reads the format from the output path", async () => {
    const { formatFromPath } = await import("../src/optimize.js");
    assert.equal(formatFromPath("a/b.JPG"), "jpg");
    assert.equal(formatFromPath("x.jpeg"), "jpg");
    assert.equal(formatFromPath("x.png"), "png");
    assert.equal(formatFromPath("x.webp"), "webp");
    assert.equal(formatFromPath("x.gif"), undefined);
    assert.equal(formatFromPath(undefined), undefined);
  });
  it("LinkedIn presets are named for what they are, and the misleading old one is out of the defaults", async () => {
    const { DEFAULT_PRESETS, SOCIAL_PRESETS } = await import("../src/edit.js");
    assert.ok("linkedin-link-1200x627" in SOCIAL_PRESETS);
    assert.deepEqual([SOCIAL_PRESETS["linkedin-square-1080"].w, SOCIAL_PRESETS["linkedin-square-1080"].h], [1080, 1080]);
    assert.ok("linkedin-1200x627" in SOCIAL_PRESETS, "old name still works for existing calls");
    assert.ok(!DEFAULT_PRESETS.includes("linkedin-1200x627"));
  });
  it("social_sizes fills the frame by default and never writes JPEG at a fixed q:v 2", () => {
    const idx = readFileSync(join(import.meta.dirname, "..", "..", "src", "index.ts"), "utf8");
    const ed = readFileSync(join(import.meta.dirname, "..", "..", "src", "edit.ts"), "utf8");
    assert.match(idx, /fit: z\.enum\(\["cover", "contain", "pad"\]\)\.default\("cover"\)/);
    assert.doesNotMatch(ed, /ext === "\.jpg" \? \["-q:v", "2"\]/);
  });
});

describe("composition_check, sharper", () => {
  const W = 40;
  const H = 40;
  it("a smooth gradient sky still counts as one band", () => {
    const a = new Uint8Array(W * H);
    let seed = 3;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = y < 16 ? 10 + y * 3 : ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % 256);
    assert.deepEqual(findEmptyBands(a, W, H), [{ edge: "top", share: 0.4 }]);
  });
  it("crops to the target aspect while avoiding the band", () => {
    const c = cropWithout([{ edge: "top", share: 0.3 }], 1086, 1448, 4 / 5)!;
    assert.ok(Math.abs(c.width / c.height - 0.8) < 0.01, `${c.width}x${c.height}`);
    assert.ok(c.y >= Math.floor(0.3 * 0.85 * 1448));
    assert.ok(c.y + c.height <= 1448 && c.x + c.width <= 1086);
  });
  it("a planned calm edge isn't cropped away", () => {
    assert.equal(cropWithout([{ edge: "top", share: 0.3, planned: true }], 1000, 1000), undefined);
  });
  it("thumbnail spread tells a flat image from a contrasty one", async () => {
    const { lumaSpread, FLAT_THUMBNAIL } = await import("../src/composition.js");
    assert.ok(lumaSpread(new Uint8Array(100).fill(40)) < FLAT_THUMBNAIL);
    const contrasty = new Uint8Array(100).map((_, i) => (i % 2 ? 230 : 15));
    assert.ok(lumaSpread(contrasty) > FLAT_THUMBNAIL);
  });
  it("design_audit caps self-scores from measurements", () => {
    const src = readFileSync(join(import.meta.dirname, "..", "..", "src", "index.ts"), "utf8");
    assert.match(src, /cap\("hierarchy", 2, "an empty band at an edge/);
    assert.match(src, /cap\("thumbnail", 2,/);
  });
});

describe("compose placement", () => {
  const W = 48;
  const H = 48;
  const art = (calmLeftCols: number) => {
    const a = new Uint8Array(W * H);
    let seed = 11;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = x < calmLeftCols ? 20 : ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % 256);
    return a;
  };
  it("text goes to the calmest corner and the logo to the calmest bottom corner left", async () => {
    const { cornerStats, placeTextAndLogo } = await import("../src/compose.js");
    const p = placeTextAndLogo(cornerStats(art(24), W, H));
    assert.ok(p.text.endsWith("left"));
    assert.ok(p.logo.startsWith("bottom") && p.logo !== p.text);
  });
  it("the text box stops where the art gets busy", async () => {
    const { calmWidth } = await import("../src/compose.js");
    assert.ok(Math.abs(calmWidth(art(19), W, H, "top-left") - 18 / 48) < 0.05);
    assert.equal(calmWidth(art(48), W, H, "top-left"), 0.6, "never wider than 60%");
    assert.equal(calmWidth(art(2), W, H, "top-left"), 0.3, "never narrower than 30%");
  });
  it("picks light text and a scrim that reaches 4.5:1 on a dark area, dark text on a light one", async () => {
    const { textStyleFor } = await import("../src/compose.js");
    const dark = textStyleFor({ corner: "top-left", detail: 20, mean: 40 });
    const light = textStyleFor({ corner: "top-left", detail: 20, mean: 220 });
    assert.equal(dark.color, "#F3F7FB");
    assert.equal(light.color, "#0B1020");
    assert.ok(dark.contrast >= 4.5 && light.contrast >= 4.5);
  });
  it("escapes the headline and never adds a glow", async () => {
    const { composeHtml, textStyleFor } = await import("../src/compose.js");
    const html = composeHtml({ width: 100, height: 100, artDataUrl: "data:image/png;base64,AA", headline: "<b>x</b>", heading: "Space Grotesk", body: "DM Sans", text: "top-left", style: textStyleFor({ corner: "top-left", detail: 5, mean: 30 }) });
    assert.doesNotMatch(html, /<b>x<\/b>/);
    assert.doesNotMatch(html, /text-shadow/);
  });
});
