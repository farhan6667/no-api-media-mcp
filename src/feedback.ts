import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "./safety.js";

/**
 * The third local journal, and the most direct one: what the user said was wrong with a result, in their
 * own terms, and what they wanted instead. design_audit learns from scores; this learns from corrections
 * like "the logo should have been mine, not the company's" or "that empty navy band at the top shouldn't
 * be there", which no score captures. design_brief reads it back and applies it on the next brief: rules
 * about the image go into the prompt, rules about text and logos go to the client as compositing rules.
 * Stays on this machine, like the other journals.
 */
export type FeedbackScope = "image" | "compositing" | "both";

export interface FeedbackEntry {
  time: string;
  /** An asset type, or "all" when the correction applies to everything. */
  asset: string;
  problem: string;
  instead: string;
  scope: FeedbackScope;
  /** The brand it was about, e.g. "SFA". Then it only applies to that brand's work, never to another's. */
  brand?: string;
}

const COMPOSITING_WORDS = /\b(logo|logos|mark|wordmark|lockup|headline|title|caption|text|font|fonts|typography|type|letters?|glow|tagline|watermark)\b/i;

/** A correction about the words or logo set on top is a compositing rule; anything else is about the image itself. */
export function inferScope(problem: string, instead: string): FeedbackScope {
  return COMPOSITING_WORDS.test(`${problem} ${instead}`) ? "compositing" : "image";
}

const MAX_BYTES = 150_000;
const KEEP_LINES = 300;
const MAX_TEXT = 240;

export function feedbackPath(home: string): string {
  return join(home, "feedback.jsonl");
}

function clean(text: string): string {
  return redact(text).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

export function recordFeedback(
  home: string,
  entry: Omit<FeedbackEntry, "time" | "scope"> & { scope?: FeedbackScope },
  now = Date.now(),
): FeedbackEntry | undefined {
  const problem = clean(entry.problem);
  const instead = clean(entry.instead);
  if (!problem || !instead) return undefined;
  const brand = entry.brand ? clean(entry.brand).slice(0, 60) : undefined;
  const e: FeedbackEntry = {
    time: new Date(now).toISOString(),
    asset: entry.asset,
    problem,
    instead,
    scope: entry.scope ?? inferScope(problem, instead),
    ...(brand ? { brand } : {}),
  };
  try {
    const f = feedbackPath(home);
    mkdirSync(dirname(f), { recursive: true });
    appendFileSync(f, JSON.stringify(e) + "\n");
    if (statSync(f).size > MAX_BYTES) {
      const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
      writeFileSync(f, lines.slice(-KEEP_LINES).join("\n") + "\n");
    }
  } catch {
    /* feedback must never break a tool call */
  }
  return e;
}

export function readFeedback(home: string): FeedbackEntry[] {
  const f = feedbackPath(home);
  if (!existsSync(f)) return [];
  const out: FeedbackEntry[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as FeedbackEntry;
      if (e && typeof e.problem === "string" && typeof e.instead === "string" && typeof e.asset === "string") out.push(e);
    } catch {
      /* skip a damaged line */
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The corrections that apply to this asset type (or to everything), newest first, one per distinct problem,
 * split by whether they're about the generated image or about the text and logos set on top of it.
 */
export function feedbackFor(entries: FeedbackEntry[], asset: string, brand?: string, max = 5): { image: string[]; compositing: string[] } {
  const seen = new Set<string>();
  const picked: FeedbackEntry[] = [];
  const b = brand?.toLowerCase();
  for (const e of [...entries].reverse()) {
    if (e.asset !== asset && e.asset !== "all" && asset !== "all") continue;
    if (e.brand && e.brand.toLowerCase() !== b) continue;
    const key = norm(e.problem);
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(e);
    if (picked.length >= max) break;
  }
  const bare = (t: string) => t.replace(/[.!?]+$/, "");
  // The image model only hears what to do: naming the unwanted thing tends to summon it.
  const positive = (e: FeedbackEntry) => `${bare(e.instead)}.`;
  const rule = (e: FeedbackEntry) => `Not: ${bare(e.problem)}. Instead: ${bare(e.instead)}.`;
  return {
    image: picked.filter((e) => e.scope !== "compositing").map(positive),
    compositing: picked.filter((e) => e.scope !== "image").map(rule),
  };
}

/** Removes one entry by its time stamp. Returns whether anything was removed. */
export function forgetFeedback(home: string, time: string): boolean {
  const all = readFeedback(home);
  const keep = all.filter((e) => e.time !== time);
  if (keep.length === all.length) return false;
  writeFileSync(feedbackPath(home), keep.map((e) => JSON.stringify(e)).join("\n") + (keep.length ? "\n" : ""));
  return true;
}
