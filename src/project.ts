import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

/**
 * Read-only look at the project to work out its visual personality, so generated media fits it:
 * a luxury 3D site gets cinematic premium renders, a modest nonprofit site gets calm respectful imagery.
 * Reads only inside the project, skips heavy folders, caps file count and size.
 */

export const TIERS = ["luxury", "premium", "playful", "corporate", "minimal", "modest", "editorial"] as const;
export type Tier = (typeof TIERS)[number];
export type Motion = "3d" | "animated" | "static";

export interface ProjectProfile {
  tier: Tier;
  motion: Motion;
  theme: "dark" | "light" | "unknown";
  palette: string[];
  fonts: string[];
  keywords: string[];
  references: string[];
  evidence: string[];
}

const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "out", ".ai-media", ".vercel", ".turbo", "coverage", ".cache"]);
const TEXT_EXT = new Set([".css", ".scss", ".ts", ".tsx", ".js", ".jsx", ".html", ".md", ".json", ".astro", ".vue", ".svelte", ".mjs"]);
const IMG_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg"]);

function walk(root: string, limit = 2500) {
  const text: string[] = [];
  const images: { path: string; size: number }[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < limit) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      if (SKIP.has(e) || e.startsWith(".") && e !== ".well-known") continue;
      const p = join(dir, e);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isSymbolicLink?.()) continue;
      if (st.isDirectory()) stack.push(p);
      else if (++seen <= limit) {
        const ext = extname(e).toLowerCase();
        if (TEXT_EXT.has(ext) && st.size < 400_000) text.push(p);
        else if (IMG_EXT.has(ext) && st.size > 8_000) images.push({ path: p, size: st.size });
      }
    }
  }
  return { text, images };
}

const KEYWORDS: [Tier, RegExp][] = [
  ["luxury", /\b(luxury|luxurious|haute|couture|jewel(le)?ry|bespoke|exclusive|boutique|villa|yacht|gold|diamond|perfume|fragrance|watch(es)?|high[- ]end)\b/gi],
  ["premium", /\b(premium|pro|elite|enterprise[- ]grade|cinematic|award|studio|agency|portfolio)\b/gi],
  ["playful", /\b(kids?|fun|game|playful|cartoon|toy|party|meme|emoji|cute)\b/gi],
  ["corporate", /\b(b2b|saas|dashboard|finance|bank|insurance|consult(ing|ancy)|enterprise|compliance|crm|analytics)\b/gi],
  ["modest", /\b(islam(ic)?|masjid|mosque|quran|madrasa|charity|nonprofit|non-profit|welfare|faith|church|temple|ummah|ramadan|halal)\b/gi],
  ["editorial", /\b(magazine|journal|blog|news|editorial|stories|publication)\b/gi],
  ["minimal", /\b(minimal(ist)?|simple|clean|zen|calm)\b/gi],
];

export function projectProfile(root: string): ProjectProfile {
  const { text, images } = walk(root);
  const evidence: string[] = [];
  let corpus = "";
  let pkgDeps: string[] = [];

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      pkgDeps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      corpus += ` ${pkg.name ?? ""} ${pkg.description ?? ""} ${(pkg.keywords ?? []).join(" ")}`;
    } catch {
      /* unreadable package.json */
    }
  }

  // Motion from dependencies.
  const has = (re: RegExp) => pkgDeps.filter((d) => re.test(d));
  const three = has(/^(three|@react-three\/|@splinetool\/|@babylonjs\/|babylonjs|playcanvas|aframe|ogl|@google\/model-viewer)/);
  const anim = has(/^(gsap|framer-motion|motion|lottie|@lottiefiles\/|locomotive-scroll|lenis|@studio-freight\/lenis|animejs|react-spring|@react-spring\/|aos|swiper)/);
  const motion: Motion = three.length ? "3d" : anim.length ? "animated" : "static";
  if (three.length) evidence.push(`3D libraries: ${three.join(", ")}`);
  if (anim.length) evidence.push(`animation libraries: ${anim.join(", ")}`);

  const colorCount = new Map<string, number>();
  const fonts = new Set<string>();
  let darkHits = 0;
  let lightHits = 0;
  for (const f of text.slice(0, 600)) {
    let s: string;
    try {
      s = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const ext = extname(f).toLowerCase();
    if ([".md", ".html", ".json", ".tsx", ".jsx", ".astro", ".vue", ".svelte"].includes(ext)) corpus += " " + s.slice(0, 20_000);
    for (const m of s.matchAll(/#([0-9a-f]{6})\b/gi)) {
      const hex = `#${m[1].toLowerCase()}`;
      colorCount.set(hex, (colorCount.get(hex) ?? 0) + 1);
    }
    for (const m of s.matchAll(/font-family\s*:\s*["']?([A-Za-z][\w\s-]{2,40})/g)) fonts.add(m[1].trim());
    for (const m of s.matchAll(/from\s+["']next\/font\/google["'][^;]*|import\s*\{\s*([A-Z][\w,\s]+)\}\s*from\s*["']next\/font\/google["']/g)) {
      (m[1] ?? "").split(",").map((x) => x.trim().replace(/_/g, " ")).filter(Boolean).forEach((x) => fonts.add(x));
    }
    for (const m of s.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&)]+)/g)) fonts.add(decodeURIComponent(m[1]).split(":")[0].replace(/\+/g, " "));
    if (/background(-color)?\s*:\s*#(0|1)[0-9a-f]{5}\b|bg-(black|zinc-9|neutral-9|slate-9|gray-9)/i.test(s)) darkHits++;
    if (/background(-color)?\s*:\s*#(f|e)[0-9a-f]{5}\b|bg-(white|zinc-50|neutral-50|slate-50|gray-50)/i.test(s)) lightHits++;
  }

  // Ignore pure black/white and greys; keep the most used brand colours.
  const isGrey = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b) < 18;
  };
  const palette = [...colorCount.entries()].filter(([h]) => !isGrey(h)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h]) => h);
  if (palette.length) evidence.push(`most used colours: ${palette.join(", ")}`);
  if (fonts.size) evidence.push(`fonts: ${[...fonts].slice(0, 4).join(", ")}`);

  // Tier from words in the project, weighted; luxury and modest win over generic "premium".
  const scores = new Map<Tier, number>();
  const words = new Set<string>();
  for (const [tier, re] of KEYWORDS) {
    const hits = corpus.match(re) ?? [];
    if (hits.length) {
      scores.set(tier, hits.length * (tier === "luxury" || tier === "modest" ? 2 : 1));
      hits.slice(0, 5).forEach((h) => words.add(h.toLowerCase()));
    }
  }
  let tier: Tier = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (motion === "3d" ? "premium" : "minimal");
  if (tier === "minimal" && motion === "3d") tier = "premium";
  if (scores.size) evidence.push(`words in the project: ${[...words].slice(0, 10).join(", ")}`);

  const theme = darkHits > lightHits * 1.3 ? "dark" : lightHits > darkHits * 1.3 ? "light" : "unknown";
  if (theme !== "unknown") evidence.push(`mostly ${theme} backgrounds`);

  const references = images
    .filter((i) => !/favicon|icon-|apple-touch|sprite|logo-?mark/i.test(i.path))
    .sort((a, b) => b.size - a.size)
    .slice(0, 6)
    .map((i) => relative(root, i.path));
  if (references.length) evidence.push(`existing images to match: ${references.length}`);

  return { tier, motion, theme, palette, fonts: [...fonts].slice(0, 4), keywords: [...words].slice(0, 12), references, evidence };
}
