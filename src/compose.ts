import { ffToBuffer } from "./optimize.js";

/**
 * Sets the real headline and the real logo over generated art, so the two things that kept going wrong by
 * hand (a cheap glowing headline, the wrong logo) are done the same careful way every time. Placement is
 * measured: the art is sampled small and the calmest corner gets the text, the calmest remaining bottom
 * corner gets the logo. Typography follows the compositing rules: a real display font, one colour, a clear
 * size gap to the sub line, aligned to a margin, a soft scrim instead of a glow, no eyebrow label.
 */
export type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

const SAMPLE = 48;

export interface RegionStats {
  corner: Corner;
  /** Detail: standard deviation of brightness. Lower is calmer. */
  detail: number;
  /** Average brightness, 0 to 255. */
  mean: number;
}

/** Pure: detail and brightness of each corner region (the outer 45% in each direction) of a w x h greyscale grid. */
export function cornerStats(lum: Uint8Array, w: number, h: number): RegionStats[] {
  const span = (n: number) => Math.max(1, Math.round(n * 0.45));
  const region = (corner: Corner, x0: number, y0: number) => {
    const vals: number[] = [];
    for (let y = y0; y < y0 + span(h); y++) for (let x = x0; x < x0 + span(w); x++) vals.push(lum[y * w + x]!);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const detail = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length);
    return { corner, detail: Math.round(detail * 10) / 10, mean: Math.round(mean) };
  };
  return [
    region("top-left", 0, 0),
    region("top-right", w - span(w), 0),
    region("bottom-left", 0, h - span(h)),
    region("bottom-right", w - span(w), h - span(h)),
  ];
}

/**
 * Pure: where the text and the logo go. Text prefers a top corner (that's where a headline is read first)
 * unless a bottom corner is clearly calmer; the logo takes the calmest bottom corner the text didn't take.
 */
export function placeTextAndLogo(stats: RegionStats[], text?: Corner, logo?: Corner): { text: Corner; logo: Corner } {
  const by = (c: Corner) => stats.find((s) => s.corner === c)!;
  const calmest = (cs: Corner[]) => cs.slice().sort((a, b) => by(a).detail - by(b).detail)[0]!;
  let t = text;
  if (!t) {
    const top = calmest(["top-left", "top-right"]);
    const bottom = calmest(["bottom-left", "bottom-right"]);
    t = by(bottom).detail < by(top).detail * 0.7 ? bottom : top;
  }
  const others = (["bottom-right", "bottom-left", "top-right", "top-left"] as Corner[]).filter((c) => c !== t);
  const bottoms = others.filter((c) => c.startsWith("bottom"));
  const l = logo ?? calmest(bottoms.length ? bottoms : others);
  return { text: t, logo: l };
}

/**
 * Pure: how far in from the text's side the art stays calm, as a share of the width (0.3 to 0.6), measured
 * over the band the text will occupy. Walking in from the edge, the first columns whose detail rises past
 * the threshold mark where the busy art starts; the text box stops before it.
 */
export function calmWidth(lum: Uint8Array, w: number, h: number, corner: Corner, threshold = 30): number {
  const top = corner.startsWith("top");
  const left = corner.endsWith("left");
  const y0 = top ? 0 : Math.floor(h * 0.62);
  const y1 = top ? Math.ceil(h * 0.38) : h;
  const detail = (x: number) => {
    const v: number[] = [];
    for (let y = y0; y < y1; y++) v.push(lum[y * w + x]!);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
  };
  let run = 0;
  let edge = w;
  for (let i = 0; i < w; i++) {
    const x = left ? i : w - 1 - i;
    run = detail(x) > threshold ? run + 1 : 0;
    if (run >= 2) {
      edge = i - 1;
      break;
    }
  }
  return Math.min(0.6, Math.max(0.3, edge / w));
}

/** WCAG relative luminance of an sRGB hex colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace("#", ""), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

export function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Brightness 0..255 of a grey sample to an approximate relative luminance. */
const greyLum = (v: number) => luminance(`#${Math.round(v).toString(16).padStart(2, "0").repeat(3)}`);

export interface TextStyle {
  color: string;
  scrim: string;
  scrimAlpha: number;
  /** Estimated contrast of the text over the scrimmed background. */
  contrast: number;
}

/**
 * Pure: light text on a dark area, dark text on a light one, with a scrim strong enough to reach 4.5:1
 * against the area's average brightness. Busy areas get a slightly stronger scrim, since an average hides
 * the bright bits under individual letters.
 */
export function textStyleFor(region: RegionStats): TextStyle {
  const dark = region.mean < 140;
  const color = dark ? "#F3F7FB" : "#0B1020";
  const scrimRgb = dark ? [4, 7, 14] : [246, 248, 251];
  const textL = luminance(color);
  let alpha = 0;
  for (; alpha <= 0.9; alpha += 0.05) {
    const bg = region.mean * (1 - alpha) + scrimRgb[0]! * alpha;
    if (contrastRatio(textL, greyLum(bg)) >= 4.5) break;
  }
  alpha = Math.min(0.9, alpha + Math.min(0.25, region.detail / 160));
  const bg = region.mean * (1 - alpha) + scrimRgb[0]! * alpha;
  return {
    color,
    scrim: `rgba(${scrimRgb.join(",")},`,
    scrimAlpha: Math.round(alpha * 100) / 100,
    contrast: contrastRatio(textL, greyLum(bg)),
  };
}

export interface ComposeInput {
  width: number;
  height: number;
  artDataUrl: string;
  headline: string;
  subline?: string;
  heading: string;
  body: string;
  googleFontsUrl?: string;
  text: Corner;
  logo?: { dataUrl: string; corner: Corner; tile: boolean };
  style: TextStyle;
  /** Share of the width the text may use before the art gets busy (calmWidth). */
  textWidth?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cssFont = (f: string) => `'${f.replace(/['\\<>]/g, "")}'`;

/** Pure: the HTML page that renders the composite at the art's exact size. */
export function composeHtml(c: ComposeInput): string {
  const W = c.width;
  const H = c.height;
  const margin = Math.round(Math.min(W, H) * 0.07);
  const boxW = Math.round(W * (c.textWidth ?? 0.46)) - margin;
  // A single word can't wrap, so the longest one has to fit the box (bold display faces run about 0.6em a letter).
  const longest = Math.max(...c.headline.split(/\s+/).map((w) => w.length), 1);
  const headSize = Math.round(Math.min(W * 0.11, H * 0.09, boxW / (longest * 0.6)) * (c.headline.length > 18 ? 0.85 : 1));
  const subSize = Math.max(14, Math.round(headSize * 0.32));
  const top = c.text.startsWith("top");
  const left = c.text.endsWith("left");
  const scrimPos = `${left ? "22%" : "78%"} ${top ? "16%" : "84%"}`;
  const a = c.style.scrimAlpha;
  const logoW = Math.round(W * 0.13);
  const logoTop = c.logo?.corner.startsWith("top");
  const logoLeft = c.logo?.corner.endsWith("left");
  const fonts = c.googleFontsUrl && /^https:\/\/fonts\.googleapis\.com\//.test(c.googleFontsUrl) ? `<link rel="stylesheet" href="${esc(c.googleFontsUrl)}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${fonts}<style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;position:relative;overflow:hidden;background:#000}
.art{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:radial-gradient(ellipse 62% 40% at ${scrimPos},${c.style.scrim}${a}) 0%,${c.style.scrim}${Math.round(a * 0.55 * 100) / 100}) 45%,${c.style.scrim}0) 100%)}
.type{position:absolute;${top ? "top" : "bottom"}:${margin}px;${left ? "left" : "right"}:${margin}px;max-width:${boxW}px;text-align:${left ? "left" : "right"}}
h1{font-family:${cssFont(c.heading)},'Segoe UI',system-ui,sans-serif;font-weight:700;font-size:${headSize}px;line-height:0.98;letter-spacing:-0.02em;color:${c.style.color}}
p{margin-top:${Math.round(headSize * 0.28)}px;font-family:${cssFont(c.body)},'Segoe UI',system-ui,sans-serif;font-weight:500;font-size:${subSize}px;line-height:1.3;color:${c.style.color};opacity:.82}
.logo{position:absolute;${logoTop ? "top" : "bottom"}:${margin}px;${logoLeft ? "left" : "right"}:${margin}px;width:${logoW}px${c.logo?.tile ? ";-webkit-mask-image:radial-gradient(ellipse 58% 56% at 50% 50%,#000 62%,transparent 100%);mask-image:radial-gradient(ellipse 58% 56% at 50% 50%,#000 62%,transparent 100%)" : ""}}
</style></head><body>
<img class="art" src="${c.artDataUrl}">
<div class="scrim"></div>
<div class="type"><h1>${esc(c.headline)}</h1>${c.subline ? `<p>${esc(c.subline)}</p>` : ""}</div>
${c.logo ? `<img class="logo" src="${c.logo.dataUrl}">` : ""}
</body></html>`;
}

/** Greyscale sample of an image for placement and contrast. */
export async function sampleGrey(input: string): Promise<{ lum: Uint8Array; w: number; h: number }> {
  const buf = await ffToBuffer(["-i", input, "-vf", `scale=${SAMPLE}:-2:flags=area,format=gray`, "-f", "rawvideo", "-pix_fmt", "gray", "-frames:v", "1", "pipe:1"]);
  const h = Math.floor(buf.length / SAMPLE);
  return { lum: new Uint8Array(buf.buffer, buf.byteOffset, SAMPLE * h), w: SAMPLE, h };
}

/** Whether a logo sits on its own opaque tile (then it gets a feathered mask so it doesn't look boxed). */
export async function logoHasTile(file: string): Promise<boolean> {
  try {
    const buf = await ffToBuffer(["-i", file, "-vf", "scale=32:32,format=rgba", "-f", "rawvideo", "-pix_fmt", "rgba", "-frames:v", "1", "pipe:1"]);
    const a = (x: number, y: number) => buf[(y * 32 + x) * 4 + 3]!;
    return [a(6, 6), a(25, 6), a(6, 25), a(25, 25)].every((v) => v > 200);
  } catch {
    return false;
  }
}
