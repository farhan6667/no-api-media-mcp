/**
 * Who sees the asset, as distinct from what it's about (that's domainCues in design.ts). Each persona changes
 * the art direction (tier, palette) and adds one honest critique question aimed at that specific reader.
 *
 * Sourced from the ui-ux-pro-max design skill's product and style databases (real, reviewed entries: "B2B
 * Service", "Developer Tool / IDE", "Open Source Project Landing", "Vibrant & Block-based"), not invented.
 * Kept to the small set of audiences this project's own work actually needs; add more the same way, from a
 * real source, rather than guessing.
 */
export interface Persona {
  id: string;
  match: RegExp;
  /** One sentence of art direction: pacing, formality, visual density, risk tolerance. */
  tone: string;
  /** Used only when the caller didn't set style.tier. */
  tierHint?: "luxury" | "premium" | "playful" | "corporate" | "minimal" | "modest" | "editorial";
  /** Used only when neither brand.colors nor a domain-cue palette applied. */
  paletteHint?: string[];
  /** One extra question added to the critique list, asked from this reader's seat. */
  critique: string;
}

export const AUDIENCE_PERSONAS: Persona[] = [
  {
    id: "executive",
    match: /\b(executives?|cisos?|ctos?|cios?|decision[- ]makers?|buyers?|boards?|enterprise (?:clients?|customers?)|hiring managers?|leadership)\b/i,
    tone: "A time-pressed reader skimming between meetings: calm, restrained, trustworthy, no exclamation energy, nothing that looks like it's trying to sell too hard.",
    tierHint: "corporate",
    paletteHint: ["#0F172A", "#1E293B", "#64748B", "#F8FAFC"],
    critique: "Would a time-pressed executive get the one thing that matters in three seconds, without feeling sold to?",
  },
  {
    id: "developer",
    match: /\b(developers?|engineers?|programmers?|technical (?:peers?|audiences?|readers?)|coders?)\b/i,
    tone: "A peer who can tell marketing gloss from substance: dark, quiet, technical, a real detail (a command, a file, a real number) earns more trust than a polished metaphor.",
    tierHint: "minimal",
    paletteHint: ["#0D1117", "#58A6FF", "#8B949E", "#E6EDF3"],
    critique: "Would a developer reading this believe it, or does it read as generic marketing they'll tune out?",
  },
  {
    id: "open-source-community",
    match: /\b(open[- ]source|github|contributors?|maintainers?|stargazers?|the community)\b/i,
    tone: "Someone scanning a GitHub feed or a repo list: looks unmistakably like an open source project, not a product landing page. A thin language-colour bar, a star/fork motif, calm dark background.",
    tierHint: "premium",
    paletteHint: ["#0D1117", "#F2CC60", "#8B949E", "#A371F7"],
    critique: "Does it read instantly as an open source project, not a corporate product ad?",
  },
  {
    id: "security-practitioner",
    match: /\b(security (?:analysts?|engineers?|practitioners?|researchers?|teams?)|pentesters?|soc analysts?|red team|blue team|threat hunters?)\b/i,
    tone: "A working analyst who has seen a hundred vendor decks: direct, technical, a little understated confidence, nothing that oversells a capability.",
    tierHint: "premium",
    critique: "Would a working security analyst trust this, or does it feel like another vendor pitch?",
  },
  {
    id: "consumer",
    match: /\b(general public|consumers?|gamers?|casual users?|everyday users?|social media (?:audience|users?)|youth)\b/i,
    tone: "Someone scrolling for fun, not for work: bold, bright, a little playful, big and immediate rather than subtle.",
    tierHint: "playful",
    paletteHint: ["#39FF14", "#BF00FF", "#FF1493", "#00FFFF"],
    critique: "Is it fun and inviting at a glance, without turning childish?",
  },
];

export function matchPersona(...texts: (string | undefined)[]): Persona | undefined {
  const text = texts.filter(Boolean).join(" ");
  if (!text) return undefined;
  return AUDIENCE_PERSONAS.find((p) => p.match.test(text));
}
