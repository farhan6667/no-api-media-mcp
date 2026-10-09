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
}

const VISUAL: AssetType[] = ["hero", "banner", "poster", "social-post", "infographic", "illustration"];

export const LESSONS: Lesson[] = [
  { rule: "Never let the model draw a real logo, text, numbers or screens. Ask for none, then place the real logo and exact words afterwards.", assets: "all", seen: 3 },
  { rule: "Keep the subject centred with a wide margin on every side, so it survives a wide crop, a phone crop and a link-preview crop.", assets: ["hero", "banner", "social-post", "background-video", "product-video"], seen: 3 },
  { rule: "Audit like a lead designer and redo what fails. The first pass is rarely the one to ship.", assets: "all", seen: 3 },
  { rule: "Give exact hex colours and name the one accent colour and where it goes. Palette drift is the first thing a review catches.", assets: "all", seen: 3 },
  { rule: "Make luxury concrete: deep matte dark base, polished glass planes, volumetric light, fine grain, one thin warm accent, restrained not cartoonish.", assets: ["hero", "banner", "poster", "social-post"], seen: 2 },
  { rule: "Ask for a calm, dark, low-detail zone on the side where the headline goes and put the bright detail in the middle band.", assets: ["hero", "banner", "social-post", "poster"], seen: 2 },
  { rule: "A single big centred object reads as stock. Ask for an abstract backdrop with open space and let the real brand mark be the focal point.", assets: ["hero", "banner", "poster", "social-post"], seen: 2 },
  { rule: "A black-background logo on busy art washes out and shows a box. Put it on a dark glass plate or a feathered mask.", assets: VISUAL, seen: 2 },
  { rule: "Use the real brand logo file in a corner for consistency. Check its size and transparency first, never redraw it.", assets: VISUAL, seen: 2 },
  { rule: "Build a share card at its real size (1200x630) and fit the whole subject. Extend the background instead of cropping the subject.", assets: ["social-post", "banner"], seen: 2 },
  { rule: "Fix one problem, then look again. Stacking five fixes at once hides which one helped.", assets: "all", seen: 2 },
  { rule: "Name the story beats by second, the palette and a centred subject, and add no text, no logos, no people. Retries cost credits.", assets: ["background-video", "product-video"], seen: 1 },
  { rule: "Zoom into documents, screens and clipboards in generated art. That is where models hide fake unreadable text.", assets: ["illustration", "product-shot", "infographic"], seen: 1 },
  { rule: "Match the art to the page: same background tone, width and edge fade. If it looks pasted on, cut the background out.", assets: ["hero", "illustration"], seen: 1 },
];

const MAX_RULE = 190;

export function lessonsFor(asset: AssetType, max = 3): string[] {
  return LESSONS.filter((l) => l.assets === "all" || l.assets.includes(asset))
    .sort((a, b) => b.seen - a.seen)
    .slice(0, max)
    .map((l) => l.rule.slice(0, MAX_RULE));
}
