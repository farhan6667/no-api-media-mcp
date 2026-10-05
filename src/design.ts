/**
 * Art direction built into the server, so any MCP client gets designer-grade prompts instead of
 * "a logo with a key on it". Each asset type has: what good looks like, three genuinely different
 * concept directions, a prompt skeleton, and a hard critique checklist to judge every result against.
 *
 * This is deterministic text, no model call: the client's own model does the thinking, guided by it.
 */

export const ASSET_TYPES = ["logo", "app-icon", "hero", "illustration", "product-shot", "social-post", "banner", "background-video", "product-video"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export interface Brand {
  name?: string;
  colors?: string[];
  mood?: string;
  audience?: string;
  avoid?: string[];
}

interface Direction {
  name: string;
  idea: string;
  prompt: (subject: string, b: Brand) => string;
}

interface Playbook {
  goal: string;
  principles: string[];
  directions: Direction[];
  critique: string[];
  provider: string;
  aspect: string;
  finish: string;
}

const palette = (b: Brand, fallback: string) => (b.colors?.length ? `strict palette: ${b.colors.join(", ")}, plus white` : fallback);
const mood = (b: Brand, fallback: string) => b.mood ?? fallback;
const avoid = (b: Brand, base: string[]) => [...base, ...(b.avoid ?? [])].join(", ");

const LOGO_AVOID = [
  "text", "letters", "words", "gradients", "drop shadows", "3D bevels", "glossy highlights", "stock clip-art icons",
  "app-icon rounded squares", "warning or prohibition signs", "busy detail", "more than two shapes",
];

const PLAYBOOKS: Record<AssetType, Playbook> = {
  logo: {
    goal: "A mark people can recognise at 16 px, redraw from memory, and that still works in one flat colour.",
    principles: [
      "One idea, not three. Merge concepts into a single silhouette instead of stacking icons.",
      "Geometry first: circles, squares, triangles, a consistent stroke weight, optical balance.",
      "Use negative space to carry the second meaning (the 'hidden arrow' trick).",
      "Flat vector, maximum two colours. If it needs a gradient to look good, the shape is weak.",
      "Must survive: 16 px favicon, pure black, pure white, on dark and light backgrounds.",
      "No text inside the mark. The wordmark is set separately in a real font.",
      "Avoid literal clichés of the category (padlocks for security, keys for keys). Symbolise the benefit.",
    ],
    directions: [
      {
        name: "Negative-space mark",
        idea: "Two meanings in one shape: the second one is formed by the empty space.",
        prompt: (s, b) =>
          `Minimalist geometric logo mark for ${b.name ?? "a brand"}: ${s}. A single bold flat silhouette where the negative space forms the second idea. ` +
          `Even stroke weight, perfect geometry, centred on a plain white background, ${palette(b, "one deep colour plus white")}. ` +
          `Swiss modernist, in the style of Paul Rand and Chermayeff & Geismar. Vector look, crisp edges. Avoid: ${avoid(b, LOGO_AVOID)}.`,
      },
      {
        name: "Monogram",
        idea: "A custom letterform or two, drawn as a shape, not typed.",
        prompt: (s, b) =>
          `Custom geometric monogram logo for ${b.name ?? "a brand"}, built from simple strokes and circles, suggesting ${s}. ` +
          `Single flat colour on white, ${palette(b, "one deep colour")}, balanced, timeless, like a Pentagram identity. ` +
          `Only the drawn letter shapes, no other text. Avoid: ${avoid(b, LOGO_AVOID.filter((x) => x !== "letters"))}.`,
      },
      {
        name: "Showcase emblem",
        idea: "Rich, glowing, story-telling badge with the wordmark: made for README banners, social previews and launch posts. Pair it with a simple mark for favicons.",
        prompt: (s, b) =>
          `Premium showcase logo emblem with wordmark "${b.name ?? "Brand"}" in bold clean rounded sans-serif lettering, spelled exactly. ` +
          `A connected story from left to right that shows ${s}, as glossy glowing neon-glass icons joined by one flowing light ribbon, ` +
          `${palette(b, "electric blue, cyan and violet")} on a dark background with soft glow, thick dark outline like a premium sticker, high detail, centred, wide.`,
      },
      {
        name: "Abstract symbol",
        idea: "A simple abstract form that suggests the benefit (speed, freedom, creation) instead of the object.",
        prompt: (s, b) =>
          `Abstract minimalist symbol logo expressing ${s}. Two or three overlapping flat geometric forms with a subtle overlap colour, ` +
          `${palette(b, "two harmonious colours")}, mood: ${mood(b, "confident, modern, friendly")}. Plain white background, centred, generous margin. ` +
          `Avoid: ${avoid(b, LOGO_AVOID.filter((x) => x !== "gradients"))}.`,
      },
    ],
    critique: [
      "Squint test: is the silhouette still distinctive when blurred?",
      "16 px test: shrink it. Does it turn into a blob or keep its idea?",
      "One-colour test: would it work in pure black on white?",
      "Is there exactly one idea, or several icons stacked together?",
      "Does it look like generic stock or clip-art? If you've seen it before, reject it.",
      "No stray text, artefacts, uneven strokes, or off-centre balance.",
      "Does it express the benefit, not just the literal object?",
    ],
    provider: "flow (generate 4 per direction), then pick and redraw the winner as clean SVG",
    aspect: "1:1",
    finish: "Image models rarely produce production-ready logos. Use them for concepts, then rebuild the chosen concept as an SVG with exact geometry.",
  },
  "app-icon": {
    goal: "An icon that reads instantly in a grid of other icons and on the user's home screen.",
    principles: ["One central glyph, large, centred", "Bold silhouette, little detail", "Background can carry colour; glyph high contrast", "Follow platform safe zones (keep the glyph within ~70% of the tile)"],
    directions: [
      { name: "Bold glyph", idea: "Single strong symbol on a solid colour.", prompt: (s, b) => `App icon: one bold flat white glyph of ${s} centred on a solid ${b.colors?.[0] ?? "deep indigo"} tile, simple, high contrast, no text, no gradient, no shadow.` },
      { name: "Soft depth", idea: "Subtle material depth, still simple.", prompt: (s, b) => `App icon, soft material style: ${s} as one rounded glyph with a gentle top light, ${palette(b, "two-tone palette")}, clean, no text.` },
      { name: "Line art", idea: "Monoline glyph, elegant.", prompt: (s, b) => `Monoline app icon of ${s}, even 6% stroke, ${palette(b, "single accent colour on off-white")}, centred, no text.` },
    ],
    critique: ["Recognisable at 29 px?", "Distinct from the obvious competitors?", "Glyph inside safe zone?", "No text, no thin details that vanish when small?"],
    provider: "flow or codex",
    aspect: "1:1",
    finish: "Export 1024 px master, then sizes with media_optimize.",
  },
  hero: {
    goal: "A wide image that sets the mood of the page and leaves room for the headline.",
    principles: ["Leave clear negative space where the headline sits (usually left or top third)", "One focal subject, depth of field", "Lighting and palette match the brand", "No text in the image, real text goes in HTML"],
    directions: [
      { name: "Editorial photo", idea: "Realistic, cinematic.", prompt: (s, b) => `Cinematic editorial photograph: ${s}. Soft natural light, shallow depth of field, ${palette(b, "muted natural palette")}, mood: ${mood(b, "calm and premium")}. Subject on the right third, clean empty space on the left for a headline. No text, no logos, no watermark.` },
      { name: "3D render", idea: "Polished product-style 3D scene.", prompt: (s, b) => `Premium 3D render: ${s}, studio lighting, soft reflections, ${palette(b, "brand-coloured accents on neutral background")}, subject right of centre, clean negative space left. No text.` },
      { name: "Illustrated", idea: "Flat or semi-flat illustration.", prompt: (s, b) => `Modern flat illustration, wide composition: ${s}. Limited ${palette(b, "4-colour palette")}, subtle grain texture, generous empty area on the left for a headline. No text.` },
    ],
    critique: ["Is there real space for the headline?", "Does the focal point survive a mobile crop (centre square)?", "Faces, hands and objects anatomically right?", "Palette matches the site?", "No garbled text or watermark?"],
    provider: "flow (16:9, upscaled)",
    aspect: "16:9",
    finish: "media_optimize to WebP, max_width 1920; make a 1:1 crop for mobile if the layout needs it.",
  },
  illustration: {
    goal: "Consistent spot illustrations that look like one artist drew all of them.",
    principles: ["Lock a style sentence and reuse it word for word", "Same palette, line weight and lighting across the set", "Simple backgrounds"],
    directions: [
      { name: "Flat geometric", idea: "Clean shapes.", prompt: (s, b) => `Flat geometric spot illustration of ${s}, ${palette(b, "limited palette")}, consistent 2 px outlines, white background, no text.` },
      { name: "Hand-drawn", idea: "Warm and human.", prompt: (s, b) => `Hand-drawn ink and wash illustration of ${s}, ${palette(b, "two accent colours")}, light paper texture, white background, no text.` },
      { name: "Isometric", idea: "Technical, tidy.", prompt: (s, b) => `Isometric illustration of ${s}, 30-degree grid, ${palette(b, "soft brand colours")}, white background, no text.` },
    ],
    critique: ["Same style as the rest of the set?", "Reads at the size it will be used?", "No text or stray artefacts?"],
    provider: "flow",
    aspect: "4:3",
    finish: "Keep the exact style sentence in .ai-media/presets.json for the next ones.",
  },
  "product-shot": {
    goal: "A clean, believable product image that sells.",
    principles: ["Real materials and believable light", "Product fills 60 to 70% of the frame", "Neutral or brand-coloured backdrop"],
    directions: [
      { name: "Studio seamless", idea: "Catalogue clean.", prompt: (s) => `Studio product photograph of ${s} on a seamless light grey backdrop, softbox lighting, subtle shadow, sharp focus, 85mm lens, no text.` },
      { name: "Lifestyle", idea: "In use.", prompt: (s, b) => `Lifestyle photograph of ${s} in use, natural window light, ${mood(b, "warm and authentic")}, shallow depth of field, no text, no logos except the product's own.` },
      { name: "Hero splash", idea: "Dramatic.", prompt: (s, b) => `Dramatic hero product shot of ${s}, dark backdrop, rim light, ${palette(b, "single brand-colour accent light")}, no text.` },
    ],
    critique: ["Does the product look physically correct (labels, proportions)?", "Clean edges for cut-out use?", "No invented branding or misspelled labels?"],
    provider: "flow or codex",
    aspect: "1:1",
    finish: "media_optimize, keep the full-size original in .ai-media.",
  },
  "social-post": {
    goal: "Stops the scroll in a feed in under a second.",
    principles: ["One message, one visual", "High contrast, bold composition", "Leave room for the caption overlay if needed", "Platform aspect: 4:5 or 1:1 feed, 9:16 stories"],
    directions: [
      { name: "Bold graphic", idea: "Colour block + one object.", prompt: (s, b) => `Bold graphic social media visual: ${s} on a solid ${b.colors?.[0] ?? "vivid"} background, strong shadow, centred, no text.` },
      { name: "Photo story", idea: "Authentic photo.", prompt: (s, b) => `Authentic candid photo for social media: ${s}, natural light, ${mood(b, "warm")}, space at the top for a caption, no text.` },
      { name: "Collage", idea: "Editorial cut-paper.", prompt: (s) => `Editorial cut-paper collage of ${s}, layered textures, playful, no text.` },
    ],
    critique: ["Readable as a thumbnail?", "Clear single message?", "Right aspect for the platform?"],
    provider: "flow",
    aspect: "3:4",
    finish: "Real text and logo are added in a design tool or HTML, not by the model.",
  },
  banner: {
    goal: "A wide, calm image with room for text on top.",
    principles: ["Low detail where text will sit", "Subtle, on-brand, not distracting"],
    directions: [
      { name: "Abstract gradient mesh", idea: "Soft shapes.", prompt: (s, b) => `Abstract soft mesh background inspired by ${s}, ${palette(b, "brand colours")}, very low detail, wide, no text.` },
      { name: "Pattern", idea: "Repeating motif.", prompt: (s, b) => `Subtle repeating geometric pattern evoking ${s}, ${palette(b, "two tones")}, low contrast, wide, no text.` },
      { name: "Scene", idea: "Wide landscape.", prompt: (s, b) => `Wide panoramic scene: ${s}, ${mood(b, "calm")}, large sky or empty area for text, no text.` },
    ],
    critique: ["Would white or dark text be readable on it?", "Nothing important at the edges that will be cropped?"],
    provider: "flow",
    aspect: "16:9",
    finish: "media_optimize to WebP.",
  },
  "background-video": {
    goal: "A short calm loop behind a hero that never fights the headline.",
    principles: ["Slow camera motion, no cuts", "Low contrast, no faces looking at the camera", "Start and end frames similar so it loops", "No audio"],
    directions: [
      { name: "Slow push-in", idea: "Gentle dolly.", prompt: (s, b) => `Slow cinematic push-in shot of ${s}, soft light, ${palette(b, "muted palette")}, very gentle motion, seamless loop feel, no text, no people facing camera.` },
      { name: "Ambient motion", idea: "Particles, light, water.", prompt: (s) => `Ambient abstract motion: ${s}, slow drifting light and particles, calm, loopable, no text.` },
      { name: "Macro", idea: "Close-up texture.", prompt: (s) => `Macro slow-motion close-up of ${s}, shallow depth of field, calm, loopable, no text.` },
    ],
    critique: ["Does the start match the end (loop)?", "Is motion slow enough not to distract?", "No flicker or morphing artefacts?"],
    provider: "flow (veo-lite for drafts, veo-fast for final)",
    aspect: "16:9",
    finish: "media_optimize with keep_audio false; add a poster image.",
  },
  "product-video": {
    goal: "A short clip that shows the product doing its thing.",
    principles: ["One action per shot", "Describe camera, subject, action, light, in that order", "Keep it under 8 seconds per shot"],
    directions: [
      { name: "Orbit", idea: "Camera circles the product.", prompt: (s) => `Smooth 180-degree orbit around ${s} on a clean studio set, soft key light, reflections, no text.` },
      { name: "In use", idea: "Hands using it.", prompt: (s) => `Close-up of hands using ${s}, natural light, realistic motion, shallow depth of field, no text.` },
      { name: "Reveal", idea: "Light sweep reveal.", prompt: (s, b) => `Dramatic reveal of ${s} from darkness with a light sweep, ${palette(b, "brand accent light")}, no text.` },
    ],
    critique: ["Product shape stays consistent across frames?", "Hands and motion natural?", "No invented logos or text?"],
    provider: "flow or higgsfield",
    aspect: "16:9",
    finish: "media_optimize.",
  },
};

export interface Style {
  tier?: "luxury" | "premium" | "playful" | "corporate" | "minimal" | "modest" | "editorial";
  motion?: "3d" | "animated" | "static";
  theme?: "dark" | "light" | "unknown";
  /** Project images the client looked at, described in a few words ("dark marble hero with gold type"). */
  referenceNotes?: string;
}

/** How each project personality changes the look. Logos stay flat; everything else gets the full treatment. */
const TIER_STYLE: Record<NonNullable<Style["tier"]>, { look: string; logo: string; critique: string }> = {
  luxury: {
    look: "luxury art direction: deep rich tones, restrained gold or champagne accents, soft directional light, fine materials (marble, silk, brushed metal, glass), lots of negative space, editorial composition, shot like a high-end fashion or jewellery campaign",
    logo: "refined and elegant, thin precise lines, generous spacing, feels expensive and quiet, not loud",
    critique: "Does it feel expensive and calm, like a luxury house campaign? Anything cheap, cluttered or loud fails.",
  },
  premium: {
    look: "premium tech art direction: polished, cinematic lighting with soft rim light, subtle reflections, clean studio backdrop, crisp detail, Apple-keynote level finish",
    logo: "confident and precise, balanced geometry, modern",
    critique: "Would this sit next to a top-tier product launch without looking amateur?",
  },
  playful: {
    look: "playful art direction: bright saturated colours, rounded friendly shapes, bouncy energy, soft shadows, joyful",
    logo: "rounded, friendly, a little cheeky, still simple",
    critique: "Is it fun without becoming messy or childish for the audience?",
  },
  corporate: {
    look: "corporate art direction: trustworthy and clear, neutral backgrounds, natural light, diverse professional people only if needed, no gimmicks",
    logo: "stable, clear, trustworthy, strong geometry",
    critique: "Does it build trust? Anything gimmicky or off-brand fails.",
  },
  minimal: {
    look: "minimal art direction: one subject, lots of white space, soft even light, limited palette",
    logo: "as few shapes as possible",
    critique: "Is every element necessary?",
  },
  modest: {
    look: "modest, respectful art direction: calm natural light, dignified composition, modest clothing, no music instruments, no alcohol, no immodest or sensual imagery, gentle palette, sense of peace",
    logo: "dignified, calm, timeless",
    critique: "Is it fully respectful and modest for a faith or community audience? Any immodesty, music, alcohol or flashy styling fails.",
  },
  editorial: {
    look: "editorial art direction: magazine-quality photography, considered framing, natural texture, storytelling",
    logo: "typographic sensibility, classic proportions",
    critique: "Would a good magazine art director print it?",
  },
};

const MOTION_STYLE: Record<NonNullable<Style["motion"]>, string> = {
  "3d": "rendered as high-end 3D: physically based materials, soft global illumination, depth of field, glass and subtle subsurface where fitting, like an Octane or Blender Cycles studio render",
  animated: "designed to feel alive: dynamic composition, implied motion, layered depth that works well with parallax and scroll animation",
  static: "",
};

function styled(prompt: string, asset: AssetType, s: Style): string {
  if (!s.tier && !s.motion && !s.referenceNotes) return prompt;
  const t = s.tier ? TIER_STYLE[s.tier] : undefined;
  const parts: string[] = [];
  if (asset === "logo") {
    if (t) parts.push(`Character: ${t.logo}.`);
  } else {
    if (t) parts.push(`Style: ${t.look}.`);
    if (s.motion && MOTION_STYLE[s.motion]) parts.push(`${MOTION_STYLE[s.motion]}.`);
    if (s.theme === "dark") parts.push("Designed to sit on a dark website, so keep shadows rich and highlights controlled.");
  }
  if (s.referenceNotes) parts.push(`Match the project's existing visuals: ${s.referenceNotes}.`);
  return `${prompt} ${parts.join(" ")}`;
}

export function designBrief(asset: AssetType, subject: string, brand: Brand = {}, style: Style = {}) {
  const p = PLAYBOOKS[asset];
  const extraCritique = style.tier ? [TIER_STYLE[style.tier].critique] : [];
  return {
    asset,
    style,
    goal: p.goal,
    principles: p.principles,
    directions: p.directions.map((d) => ({ name: d.name, idea: d.idea, prompt: styled(d.prompt(subject, brand), asset, style) })),
    critique: [...p.critique, ...extraCritique],
    recommended: { provider: p.provider, aspect: p.aspect },
    process: [
      "Generate every direction (several variants each when the provider allows).",
      "Look at every result. Score it against the critique list and write down what fails.",
      "Pick the best direction, then fix the prompt for the exact failures. Change one thing at a time.",
      "Up to 3 rounds. Show the user the shortlist with your reasoning before using anything.",
      p.finish,
    ],
  };
}
