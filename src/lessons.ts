import type { AssetType } from "./design.js";

/**
 * Built-in lessons from real use. Each one is a mistake that happened and was fixed, written as a rule.
 * design_brief adds the ones that fit the asset type, so the same mistake is avoided on the first try.
 * `seen` is how many sessions it was observed in, `all` means every asset type. Keep every rule short:
 * prompts have a size limit and long advice gets ignored.
 */
export interface Lesson {
  rule: string;
  assets: AssetType[] | "all";
  seen: number;
  /** prompt: goes to the image model. review: for the client's own review and compositing, never sent to the model. */
  to: "prompt" | "review";
}

const VISUAL: AssetType[] = ["hero", "banner", "poster", "social-post", "infographic", "illustration"];

export const LESSONS: Lesson[] = [
  { rule: "Never let the model draw a real logo, text, numbers or screens. Ask for none, then place the real logo and exact words afterwards.", assets: "all", seen: 3, to: "prompt" },
  { rule: "Keep the subject inside the centre of the frame so it survives wide, phone and link-preview crops, and let the setting run to every edge.", assets: ["hero", "banner", "social-post", "background-video", "product-video"], seen: 3, to: "prompt" },
  { rule: "Audit like a lead designer and redo what fails. The first pass is rarely the one to ship.", assets: "all", seen: 3, to: "review" },
  { rule: "Give exact hex colours and name the one accent colour and where it goes. Palette drift is the first thing a review catches.", assets: "all", seen: 3, to: "prompt" },
  { rule: "Make luxury concrete: deep matte dark base, polished glass planes, volumetric light, fine grain, one thin warm accent, restrained not cartoonish.", assets: ["hero", "banner", "poster", "social-post"], seen: 2, to: "prompt" },
  { rule: "When a headline will go on the image, ask for a calm low-detail zone on that side and keep the bright detail in the middle band.", assets: ["hero", "banner", "social-post", "poster"], seen: 2, to: "prompt" },
  { rule: "Never leave an empty band or blank sky for text that won't be added. Fill the frame, then run composition_check and crop what is still empty.", assets: ["banner", "social-post", "poster", "hero"], seen: 2, to: "prompt" },
  { rule: "A feed image with no words on it is a social-post with targetAspect set, not a banner. Banners are for text laid over them.", assets: ["banner", "social-post"], seen: 1, to: "review" },
  { rule: "A single big centred object reads as stock. Ask for an abstract backdrop with open space and let the real brand mark be the focal point.", assets: ["hero", "banner", "poster", "social-post"], seen: 2, to: "prompt" },
  { rule: "A black-background logo on busy art washes out and shows a box. Put it on a dark glass plate or a feathered mask.", assets: VISUAL, seen: 2, to: "review" },
  { rule: "Use the real brand logo file in a corner for consistency. Check its size and transparency first, never redraw it.", assets: VISUAL, seen: 2, to: "review" },
  { rule: "Build a share card at its real size (1200x630) and fit the whole subject. Extend the background instead of cropping the subject.", assets: ["social-post", "banner"], seen: 2, to: "review" },
  { rule: "Fix one problem, then look again. Stacking five fixes at once hides which one helped.", assets: "all", seen: 2, to: "review" },
  { rule: "Name the story beats by second, the palette and a centred subject, and add no text, no logos, no people. Retries cost credits.", assets: ["background-video", "product-video"], seen: 1, to: "prompt" },
  { rule: "Zoom into documents, screens and clipboards in generated art. That is where models hide fake unreadable text.", assets: ["illustration", "product-shot", "infographic"], seen: 1, to: "review" },
  { rule: "Match the art to the page: same background tone, width and edge fade. If it looks pasted on, cut the background out.", assets: ["hero", "illustration"], seen: 1, to: "review" },
];

/**
 * Rules for the step after generation, when the real text and logo go on top. Not sent to the image model:
 * design_brief returns them as compositing_rules for the client to apply. The first ones are mistakes from
 * real use; the rest are paraphrased from the typography and readability sources in docs/craft-sources.md.
 */
export const COMPOSITING_RULES: string[] = [
  "Use the logo of whoever publishes it. A person's own post (their LinkedIn, their portfolio) gets their personal mark; a company post gets the company mark. If unsure, ask before placing either.",
  "Make type part of the art: a real display font, colour sampled from the image, one word scaled large, the subject overlapping a letter. A lone white word with a glow in a corner reads cheap.",
  "Behind text, use a soft gradient scrim or a local blur, never a glow. Check 4.5:1 contrast for normal text and 3:1 for large type.",
  "Set the headline in the brief's display face, tighten tracking on large lowercase, leave a clear size gap to any sub line, and align both to a grid edge.",
  "Keep an all caps headline to one line with 5 to 12 percent letterspacing. Skip the small caps eyebrow label and the single word in a different colour: both read as generated.",
  "Use the logo lockup made for the background tone, light on dark, smaller than the headline, at a grid corner, with clear space around it, never boxed.",
  "Before shipping, run composition_check on the final file. An empty band at an edge means crop it, fill it with the real headline on purpose, or regenerate full bleed.",
];

/**
 * Craft rules paraphrased from published prompting guides and design references (sources in
 * docs/craft-sources.md). Unlike LESSONS these aren't mistakes we made; they're how good results are
 * described. design_brief adds the two most specific to the asset type to the prompt.
 */
export interface CraftRule {
  rule: string;
  assets: AssetType[] | "all";
  source: string[];
}

export const CRAFT_RULES: CraftRule[] = [
  { rule: "Write the prompt as one scene in full sentences and put the most important element first. Keyword lists and details buried at the end get less weight.", assets: "all", source: ["https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana", "https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/"] },
  { rule: "Say who the image is for and where it runs, such as a launch banner for security engineers. The model then makes taste choices that suit that audience.", assets: "all", source: ["https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/", "https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"] },
  { rule: "Describe what should be there, not what should not. Ask for an empty polished floor rather than no clutter, since naming an object can summon it.", assets: ["hero", "banner", "poster", "social-post", "product-shot", "illustration"], source: ["https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana", "https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/"] },
  { rule: "Build the light like a set: key light direction, soft fill, a thin rim, any practical sources and colour temperature. Never settle for dramatic lighting alone.", assets: ["hero", "banner", "poster", "social-post", "product-shot"], source: ["https://github.com/Emily2040/nano-banana-image-skill", "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana"] },
  { rule: "Name each material with its finish, like frosted glass, brushed aluminium or satin paper, and make it react to the stated light. Matte surfaces must not sparkle.", assets: ["hero", "poster", "product-shot", "product-video"], source: ["https://github.com/Emily2040/nano-banana-image-skill", "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana"] },
  { rule: "Pick a lens for the feeling: 85 to 100mm with shallow focus for intimate premium objects, 24 to 35mm with layered depth for scale and grand scenes.", assets: ["hero", "banner", "poster", "social-post", "product-shot"], source: ["https://github.com/Emily2040/nano-banana-image-skill", "https://developers.googleblog.com/en/how-to-prompt-gemini-2-5-flash-image-generation-for-the-best-results/"] },
  { rule: "Add one colour grade line, such as muted teal cinematic grade with fine grain, to set the mood in a phrase instead of stacking adjectives.", assets: ["hero", "banner", "poster", "social-post", "background-video", "product-video"], source: ["https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-nano-banana", "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide"] },
  { rule: "Spend boldness in one place. Keep everything around the hero element quiet, then remove one more element before you call it finished.", assets: "all", source: ["https://github.com/anthropics/skills/tree/main/skills/frontend-design"] },
  { rule: "Skip the generated look defaults: near black with one acid accent, cream with terracotta, identical rounded cards. Take the palette from the subject's own world.", assets: ["hero", "banner", "social-post", "poster"], source: ["https://github.com/anthropics/skills/tree/main/skills/frontend-design"] },
  { rule: "Borrow objects, textures and vernacular from the audience's daily world. A toy for young girls and a dashboard for analysts should look nothing alike.", assets: "all", source: ["https://github.com/anthropics/skills/tree/main/skills/frontend-design"] },
  { rule: "Keep at most two large elements. Mute the backdrop in value and saturation so the one saturated, high contrast area wins the eye.", assets: ["hero", "banner", "poster", "social-post", "infographic"], source: ["https://www.nngroup.com/articles/visual-hierarchy-ux-definition/"] },
  { rule: "For 9:16 stories and reels, keep headline, logo and CTA out of the top 14 percent and the bottom 20 to 35 percent, where the app interface covers it.", assets: ["social-post", "product-video"], source: ["https://confect.io/ad-glossary/safe-zones"] },
  { rule: "Open with motion and a tight close up in the first second, show the brand early and more than once, and end on one plainly stated next step.", assets: ["product-video"], source: ["https://business.google.com/en-all/think/future-of-marketing/youtube-video-ad-creative/"] },
  { rule: "Name the camera move (slow dolly in, orbit, crane up), the lens and focus behaviour, and write sound in its own sentence apart from the visuals.", assets: ["product-video", "background-video"], source: ["https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide", "https://deepmind.google/models/veo/prompt-guide/"] },
  { rule: "When editing a result, say change only this one thing and keep everything else the same, and repeat the list of things to preserve on every round.", assets: "all", source: ["https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide"] },
];

/** Craft rules for an asset type: the ones written specifically for it first, then the general ones. */
export function craftFor(asset: AssetType, max = 2): string[] {
  const specific = CRAFT_RULES.filter((c) => c.assets !== "all" && c.assets.includes(asset));
  const general = CRAFT_RULES.filter((c) => c.assets === "all");
  return [...specific, ...general].slice(0, max).map((c) => c.rule);
}

const MAX_RULE = 190;

/**
 * Lessons for one asset type and destination. Rules written for this asset type come before general
 * ones, then the more often seen, so a specific new lesson isn't crowded out by older general ones.
 */
export function lessonsFor(asset: AssetType, max = 4, to: Lesson["to"] = "prompt"): string[] {
  return LESSONS.filter((l) => l.to === to && (l.assets === "all" || l.assets.includes(asset)))
    .map((l, i) => ({ l, i, specific: l.assets !== "all" ? 1 : 0 }))
    .sort((a, b) => b.specific - a.specific || b.l.seen - a.l.seen || a.i - b.i)
    .slice(0, max)
    .map(({ l }) => l.rule.slice(0, MAX_RULE));
}
