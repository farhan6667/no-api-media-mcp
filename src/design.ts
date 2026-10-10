/**
 * Art direction built into the server, so any MCP client gets designer-grade prompts instead of
 * "a logo with a key on it". Each asset type has: what good looks like, three genuinely different
 * concept directions, a prompt skeleton, and a hard critique checklist to judge every result against.
 *
 * This is deterministic text, no model call: the client's own model does the thinking, guided by it.
 */

export const ASSET_TYPES = ["logo", "app-icon", "hero", "illustration", "product-shot", "social-post", "banner", "infographic", "poster", "background-video", "product-video"] as const;
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
  infographic: {
    goal: "One rich, premium graphic that explains the whole product at a glance: what it is, how it works, why it's good.",
    principles: [
      "A clear reading order: headline and logo, then the flow (input to output), then the key benefits",
      "Real, short, correctly spelled text. Pass every word in exact_text",
      "Glossy, glowing, high-end look with depth, panels and icons, not flat clip-art",
      "Consistent icon style and generous spacing so it doesn't feel crowded",
    ],
    directions: [
      {
        name: "Product overview",
        idea: "Hero logo, a left-to-right flow diagram, and a row of benefit cards.",
        prompt: (s) => `A premium product infographic for ${s}: the logo and headline at the top, a glowing left-to-right flow diagram in the middle showing how it works, and a row of feature cards with icons and one-line descriptions at the bottom. Dark navy background, neon-glass panels with soft glow, crisp modern sans-serif type.`,
      },
      {
        name: "Before and after",
        idea: "Split layout: the painful old way versus the new way.",
        prompt: (s) => `A premium before/after infographic for ${s}: left side shows the old frustrating way in muted greys, right side shows the new way bright and glowing, with short labels and a clear arrow between them.`,
      },
    ],
    critique: [
      "Is every word spelled exactly right? Any garbled text fails.",
      "Can someone understand the product in five seconds?",
      "Does it look like a polished launch graphic, not a slide template?",
      "Is it readable when shrunk to a phone screen?",
    ],
    provider: "codex (GPT Image renders text best), then flow (Nano Banana 2)",
    aspect: "16:9",
    finish: "media_optimize to WebP; keep the full-size original for print.",
  },
  poster: {
    goal: "A launch or social poster that stops the scroll and carries a short, exact message.",
    principles: ["One headline, one sub-line, one call to action", "Big logo or hero object", "Premium glow, depth and contrast", "Exact text only"],
    directions: [
      {
        name: "Launch poster",
        idea: "Logo on top, big headline, platform chips, call to action at the bottom.",
        prompt: (s) => `A premium portrait launch poster for ${s}: the logo large at the top, a bold two-line headline, a glowing pill with the key promise, a row of small chips for supported platforms, and a call-to-action bar at the bottom. Dark background with neon blue, cyan and violet glow, glossy 3D glass icons, crisp modern type.`,
      },
      {
        name: "Scene poster",
        idea: "A cinematic 3D scene with the headline over it.",
        prompt: (s) => `A cinematic premium poster for ${s}: a glowing 3D scene that shows the product in action, with the headline in large clean type over a calm area of the image and a short call to action at the bottom.`,
      },
    ],
    critique: ["Exact text, spelled right?", "Readable as a phone thumbnail?", "Does it feel premium and exciting, not template-like?"],
    provider: "codex (GPT Image), then flow",
    aspect: "3:4",
    finish: "Export 1080x1350 for LinkedIn/Instagram feed, 1200x627 for link previews.",
  },
};


/**
 * The "would an art director stop scrolling for this?" test. Applied to every asset, on top of the
 * asset-specific critique. Each criterion is scored 0 to 5 by the client's own model after looking at the image.
 */
export const AUDIT_RUBRIC = [
  { id: "focal-point", ask: "Does one thing win the first second, and can you say what it is without hesitating?", fix: "Remove or dim competing elements, enlarge the hero element, add contrast only around the focal point." },
  { id: "thumbnail", ask: "Shrink it to 300 px wide (a feed or a link preview). Is the message still clear?", fix: "Bigger type and shapes, fewer small details, thicker strokes." },
  { id: "hierarchy", ask: "Are there exactly three levels (title, support, detail) and does the eye travel in that order?", fix: "Set size ratios of about 3:1.5:1 and align the reading path left to right, top to bottom." },
  { id: "palette", ask: "At most three hues plus neutrals, with one accent used sparingly?", fix: "Pull colours from the brand or the topic and drop any extra hue." },
  { id: "topic-cues", ask: "Without reading a word, could a stranger tell the field (security, finance, travel, kids)?", fix: "Add one or two honest visual cues of the field, drawn as simple shapes, never a third party's logo." },
  { id: "brand-presence", ask: "Is the brand there (logo, colour, lockup) without shouting?", fix: "Place the real logo file in a consistent corner or strip after generation. Never generate a company's logo." },
  { id: "text-accuracy", ask: "Is every word spelled right, readable, and short enough?", fix: "Cut words. For exact numbers, commands or code, draw the text locally (SVG or HTML) instead of asking an image model." },
  { id: "not-template", ask: "Does it look made for this project, not like a generic slide or stock panel?", fix: "Use a real detail from the project (a real command, number or screen), and one unusual composition choice." },
] as const;

export const AUDIT_PASS = { average: 4, minimum: 3 };

export interface AuditResult {
  average: number;
  weakest: string[];
  verdict: "ship" | "revise";
  fixes: { id: string; score: number; fix: string }[];
  missing: string[];
}

/** Scores are 0 to 5 per criterion id. A missing criterion is a gap to fill, never a pass. */
export function auditScores(scores: Record<string, number>): AuditResult {
  const known = AUDIT_RUBRIC.map((r) => r.id as string);
  const missing = known.filter((id) => typeof scores[id] !== "number" || !Number.isFinite(scores[id]));
  const clamp = (n: number) => Math.min(5, Math.max(0, n));
  const given = known.filter((id) => !missing.includes(id)).map((id) => ({ id, score: clamp(scores[id]) }));
  const average = given.length ? Math.round((given.reduce((a, b) => a + b.score, 0) / known.length) * 100) / 100 : 0;
  const low = given.filter((g) => g.score < AUDIT_PASS.average).sort((a, b) => a.score - b.score);
  const fixes = low.map((g) => ({ ...g, fix: AUDIT_RUBRIC.find((r) => r.id === g.id)!.fix }));
  const weakest = low.slice(0, 3).map((g) => g.id);
  const hardFail = given.some((g) => g.score < AUDIT_PASS.minimum);
  const ship = !missing.length && average >= AUDIT_PASS.average && !hardFail;
  return { average, weakest, verdict: ship ? "ship" : "revise", fixes, missing };
}

/** Honest visual cues per field, so the industry is obvious without words. Simple shapes only, never someone's logo. */
const DOMAIN_CUES: { match: RegExp; field: string; cues: string }[] = [
  { match: /\b(cyber\s?security|infosec|siem|soc|wazuh|forensic|dfir|detection|threat|pentest|vulnerab|malware|incident response)\b/i, field: "cyber security", cues: "a shield or lock motif drawn as a simple shape, a faint hex or circuit grid, a pulse or alert line, a terminal window with a real command, cool blue and cyan on a dark background with one warm alert accent" },
  { match: /\b(devops|ci\/cd|kubernetes|docker|infrastructure|server|cloud|sysadmin)\b/i, field: "infrastructure", cues: "stacked server or node shapes, connected lines, a status dot row, a terminal or dashboard fragment" },
  { match: /\b(mcp|agent|llm|claude|cursor|codex|vibe cod|ai coding)\b/i, field: "AI coding", cues: "a code editor or terminal fragment, a glowing connection between a prompt and its result, a small chat or cursor shape" },
  { match: /\b(finance|bank|invoice|accounting|payment)\b/i, field: "finance", cues: "clean charts, a ledger or card shape, calm green or navy, steady lines" },
  { match: /\b(travel|hotel|tour|umrah|hajj|flight)\b/i, field: "travel", cues: "a destination skyline or landscape, a route line, warm natural light" },
];

export function domainCues(...texts: (string | undefined)[]): { field: string; cues: string } | undefined {
  const text = texts.filter(Boolean).join(" ");
  const hit = DOMAIN_CUES.find((d) => d.match.test(text));
  return hit ? { field: hit.field, cues: hit.cues } : undefined;
}

/** Names that belong to somebody else. Their marks are trademarks, so we express the topic through colour and motif only. */
const THIRD_PARTY = /\b(wazuh|elastic|splunk|microsoft|google|openai|chatgpt|anthropic|claude|github|docker|kubernetes|aws|azure|nvidia|apple)\b/i;
export function thirdPartyRule(...texts: (string | undefined)[]): string | undefined {
  const m = texts.filter(Boolean).join(" ").match(THIRD_PARTY);
  return m
    ? `The brief mentions ${m[1]}. Do not draw its logo or wordmark and do not imitate its mark: refer to it in text only, express the topic through colour family and simple motifs, and add a small "independent project, not affiliated" note where the asset will be public.`
    : undefined;
}

/** Assets where words are part of the design. Everywhere else the model is told to leave text out. */
const TEXT_ASSETS = new Set<AssetType>(["infographic", "poster", "social-post", "banner"]);

/** What the project is and why the asset is needed. Models do far better with this story than with keyword lists. */
export interface Context {
  /** Project or product name. */
  project?: string;
  /** One or two sentences on what it does, in plain words. */
  about?: string;
  /** Who will see it. */
  audience?: string;
  /** Where it goes: "the README header on GitHub", "the hero of the landing page", "a LinkedIn launch post". */
  usage?: string;
  /** What it should achieve: "make developers instantly get the idea and want to star the repo". */
  goal?: string;
  /** Words that must appear, exactly. Only used for text assets. */
  exactText?: string[];
  /** The shape the image will finally be cropped to, for example "3.2:1" for a profile banner. */
  targetAspect?: string;
}

/** "3.2:1", "16:9" or "3.2" to a width over height number, or undefined. */
export function parseAspect(text?: string): number | undefined {
  if (!text) return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?::|x|\/)?\s*(\d+(?:\.\d+)?)?\s*$/i.exec(text);
  if (!m) return undefined;
  const w = Number(m[1]);
  const h = m[2] ? Number(m[2]) : 1;
  return w > 0 && h > 0 ? w / h : undefined;
}

const DEFAULT_USAGE: Record<AssetType, string> = {
  logo: "as the brand mark on the website, GitHub and social profiles",
  "app-icon": "as the app icon on phones and in app stores",
  hero: "as the large hero image at the top of the website",
  illustration: "as an illustration inside the website's content",
  "product-shot": "to show the product on the website and in listings",
  "social-post": "as a social media post",
  banner: "as a wide banner with text over it",
  "background-video": "as a looping background video behind the website's headline",
  "product-video": "as a short product clip on the website and social media",
  infographic: "to explain the whole product in one image on the README, website and social media",
  poster: "as a launch post on LinkedIn and other social feeds",
};

const ARTICLE: Record<AssetType, string> = {
  logo: "a logo",
  "app-icon": "an app icon",
  hero: "a hero image",
  illustration: "an illustration",
  "product-shot": "a product image",
  "social-post": "a social media post",
  banner: "a banner",
  "background-video": "a background video",
  "product-video": "a product video",
  infographic: "an infographic",
  poster: "a poster",
};

const QUALITY: Record<NonNullable<Style["tier"]>, string> = {
  luxury: "It has to look luxurious and expensive, like a campaign from a high-end fashion or jewellery house: rich, calm, refined, every detail deliberate.",
  premium: "It has to look premium and high-end, like a launch visual from a top design studio or a big tech keynote: rich lighting, depth, glow where it fits, crisp detail, nothing cheap, flat or clip-art.",
  playful: "It should feel joyful and polished, like a top consumer app's marketing: bright, friendly, high production value.",
  corporate: "It should look trustworthy and polished, like a leading enterprise brand: clean, confident, high production value.",
  minimal: "It should feel refined and minimal, like a premium design-led brand: calm, precise, beautifully lit.",
  modest: "It should feel dignified, peaceful and premium, suitable for a faith or community audience: modest, respectful, beautifully lit, with no music instruments, alcohol or immodest imagery.",
  editorial: "It should look like a premium magazine feature: considered, natural, beautifully composed.",
};

/** Drop the keyword-list leftovers ("Avoid: a, b, c", "strict palette:") that make modern models go flat. */
function soften(visual: string): string {
  return visual
    .replace(/\s*Avoid:[^.]*\.?/g, "")
    .replace(/strict palette:/g, "brand colours")
    .replace(/\s+/g, " ")
    .trim();
}

/** Write the prompt the way a person briefs a designer: what the project is, where this goes, why, how good it must look. */
function narrative(asset: AssetType, visual: string, brand: Brand, style: Style, ctx: Context): string {
  const name = ctx.project ?? brand.name;
  const lines: string[] = [];
  lines.push(`I'm making ${ARTICLE[asset]} for ${name ?? "my project"}${ctx.about ? `. ${ctx.about.replace(/\.$/, "")}.` : "."}`);
  const who = ctx.audience ?? brand.audience;
  lines.push(`It will be used ${ctx.usage ?? DEFAULT_USAGE[asset]}${who ? `, and the people seeing it are ${who}` : ""}.`);
  if (ctx.goal) lines.push(`The goal: ${ctx.goal.replace(/\.$/, "")}.`);
  lines.push(QUALITY[style.tier ?? "premium"]);
  lines.push(`What I have in mind: ${soften(visual)}`);
  const cue = domainCues(name, ctx.about, ctx.audience, ctx.goal);
  if (cue && asset !== "logo") lines.push(`Make the field obvious without words (${cue.field}): ${cue.cues}.`);
  const tp = thirdPartyRule(name, ctx.about, ctx.goal);
  if (tp) lines.push(tp);
  const ratio = parseAspect(ctx.targetAspect);
  if (ratio && ratio > 2.1) {
    lines.push(`The final crop is very wide (${ctx.targetAspect}). Keep every important element in the middle horizontal band and leave the top and bottom as calm dark space, so nothing important is cut off.`);
  }
  if (style.look) lines.push(`Overall visual style: ${LOOKS[style.look]}.`);
  if (brand.colors?.length) lines.push(`Use the brand colours ${brand.colors.join(", ")} as the main palette.`);
  if (TEXT_ASSETS.has(asset) || (asset === "logo" && ctx.exactText?.length)) {
    if (ctx.exactText?.length) {
      lines.push(`Include exactly this text, spelled exactly like this, in clean modern type: ${ctx.exactText.map((t) => `"${t}"`).join(", ")}. No other words.`);
    } else {
      lines.push("Keep any text short and spell it correctly.");
    }
  } else {
    lines.push("Don't put any words, letters or third-party logos in the image.");
  }
  return lines.join(" ");
}


/**
 * Curated palettes and heading/body font pairings, keyed by the same field names domainCues() returns.
 * Sourced from the ui-ux-pro-max design skill's reviewed colour and typography database (real, tested
 * combinations, not invented), picked for a dark, premium, technical look. Used only when the caller hasn't
 * supplied brand.colors, so a bare design_brief call still looks considered instead of generic.
 */
const PALETTES: Record<string, string[]> = {
  "cyber security": ["#00D1FF", "#3B82FF", "#A45CFF", "#FF8A00"],
  infrastructure: ["#1E293B", "#334155", "#22C55E", "#94A3B8"],
  "AI coding": ["#00D1FF", "#8B5CF6", "#F59E0B", "#E2E8F0"],
  finance: ["#0F172A", "#F59E0B", "#8B5CF6", "#F8FAFC"],
  travel: ["#0EA5E9", "#F59E0B", "#0F172A", "#F8FAFC"],
};

const FONT_PAIRINGS: Record<string, { heading: string; body: string; googleFontsUrl: string }> = {
  "cyber security": {
    heading: "Space Grotesk", body: "DM Sans",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@500;600;700&display=swap",
  },
  infrastructure: {
    heading: "Space Grotesk", body: "DM Sans",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Space+Grotesk:wght@500;600;700&display=swap",
  },
  "AI coding": {
    heading: "Outfit", body: "Rubik",
    googleFontsUrl: "https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=Rubik:wght@400;500&display=swap",
  },
};
const DEFAULT_FONT_PAIRING = FONT_PAIRINGS["cyber security"];

/** A premium dark palette with a bold accent, sourced from the "Cybersecurity Platform" entry in the design
 * skill's database. A distinct alternative to neon-glass: flatter, higher contrast, more "terminal". */
const CYBER_MATRIX = "cyber-matrix look: near-black background, a single saturated signal-green accent for the one thing that matters, a muted red only for danger or alerts, thin hairline borders, no soft glow, flat and high-contrast like a hardened terminal, confident and a little cold";

/**
 * Named looks, so a user can say "neon glass" and get the same family of results every time.
 * neon-glass is modelled on the project's own launch graphics.
 */
export const LOOKS = {
  "neon-glass":
    "neon-glass look: deep navy to near-black background, glowing cyan, electric blue and violet light, glossy translucent glass icons and cards with soft glowing borders, flowing light ribbons, rounded bold sans-serif headings, generous spacing, luxurious and futuristic",
  "neon-glass-light":
    "light neon-glass look: soft white and pale mint background, bright cyan, blue and violet accents, glossy glass icons, white rounded cards with soft shadows, rounded bold sans-serif headings, clean and premium",
  "luxury-gold":
    "luxury gold look: deep black or espresso background, champagne gold accents, fine serif headings, marble, silk and brushed metal textures, soft directional light, quiet and expensive",
  "clay-3d":
    "soft clay 3D look: rounded matte 3D shapes, pastel colours, soft global illumination, gentle shadows, friendly and polished",
  "editorial-photo":
    "editorial photo look: natural light, real textures, considered framing, shallow depth of field, magazine quality",
  "cyber-matrix": CYBER_MATRIX,
} as const;
export type Look = keyof typeof LOOKS;

export interface Style {
  look?: Look;
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

/** image_generate accepts 4000 characters. Advice is added only while it fits, never cutting the brief itself. */
export const PROMPT_BUDGET = 3900;

export function withAdvice(base: string, advice: string[]): string {
  const kept: string[] = [];
  for (const a of advice) {
    if ([base, ...kept, a].join(" ").length <= PROMPT_BUDGET) kept.push(a);
  }
  return [base, ...kept].join(" ");
}

export interface BriefExtra {
  /** One sentence built from the local audit journal: what earlier results of this kind got wrong. */
  learned?: string;
  learnedItems?: { criterion: string; average: number; seen: number; advice: string }[];
  /** Built-in lessons that apply to this asset type. */
  lessons?: string[];
}

export function designBrief(asset: AssetType, subject: string, brand: Brand = {}, style: Style = {}, ctx: Context = {}, extra: BriefExtra = {}) {
  const p = PLAYBOOKS[asset];
  const cueField = domainCues(subject, ctx.project, ctx.about, ctx.goal)?.field;
  if (!brand.colors?.length && cueField && PALETTES[cueField]) brand = { ...brand, colors: PALETTES[cueField] };
  const typography = (cueField && FONT_PAIRINGS[cueField]) || DEFAULT_FONT_PAIRING;
  // Premium is the floor: people want their visuals to look high-end unless they ask otherwise.
  const s: Style = { ...style, tier: style.tier ?? "premium" };
  const extraCritique = [TIER_STYLE[s.tier!].critique];
  return {
    asset,
    style: s,
    goal: p.goal,
    principles: p.principles,
    directions: p.directions.map((d) => ({
      name: d.name,
      idea: d.idea,
      prompt: withAdvice(narrative(asset, styled(d.prompt(subject, brand), asset, s), brand, s, ctx), [
        ...(extra.learned ? [extra.learned] : []),
        ...(extra.lessons?.length ? [`Rules learned from past results: ${extra.lessons.join(" ")}`] : []),
      ]),
    })),
    learned: extra.learnedItems ?? [],
    typography: asset === "logo" ? undefined : { ...typography, note: "Use this pairing for any real wordmark or text you composite afterwards, loaded from its Google Fonts URL, instead of a generic system font." },
    critique: [...p.critique, ...extraCritique],
    eye_catch_audit: {
      how: "After looking at each result, score every criterion 0 to 5 and call design_audit with the scores. Ship only when the average is 4 or more and nothing is below 3.",
      criteria: AUDIT_RUBRIC.map((r) => ({ id: r.id, ask: r.ask })),
    },
    domain_cues: domainCues(subject, ctx.project, ctx.about, ctx.goal),
    third_party: thirdPartyRule(subject, ctx.project, ctx.about, ctx.goal),
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
