import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { redact } from "./safety.js";

/**
 * A second, small local journal, this one about operations rather than design quality (see learning.ts for
 * that one): which provider calls failed, and what kind of failure. The project's own SECURITY.md already
 * says plainly that "the browser-driven providers depend on the sites' pages, so a redesign can break them."
 * This turns that into something the agent can actually see, instead of a silent repeated failure, and feeds
 * the fallback chain in image_generate so one broken provider doesn't stop a whole run.
 *
 * Messages are redacted before they're ever written to disk, and nothing here is uploaded anywhere.
 */
export type FailureClass = "login" | "selector" | "timeout" | "quota" | "network" | "other";

export interface ProviderEvent {
  time: string;
  provider: string;
  ok: boolean;
  /** Only set when ok is false. */
  cls?: FailureClass;
  /** Redacted, truncated. Only set when ok is false. */
  note?: string;
}

const MAX_BYTES = 150_000;
const KEEP_LINES = 300;
const STREAK_WINDOW = 12;
const STREAK_THRESHOLD = 3;

export function reliabilityPath(home: string): string {
  return join(home, "reliability.jsonl");
}

export function classifyFailure(message: string): FailureClass {
  const m = message.toLowerCase();
  if (/not (?:logged|signed) in|login required|unauthori[sz]ed|session expired|sign in|please log in/.test(m)) return "login";
  if (/out of credits|usage limit|rate limit|quota|limit is used up/.test(m)) return "quota";
  if (/timed out|timeout/.test(m)) return "timeout";
  if (/selector|not found|no element|could not find|locator/.test(m)) return "selector";
  if (/network|dns|econnreset|fetch failed|enotfound|econnrefused/.test(m)) return "network";
  return "other";
}

export function recordProviderOutcome(home: string, provider: string, ok: boolean, cls?: FailureClass, message?: string, now = Date.now()) {
  try {
    const f = reliabilityPath(home);
    mkdirSync(dirname(f), { recursive: true });
    const entry: ProviderEvent = { time: new Date(now).toISOString(), provider, ok, ...(ok ? {} : { cls, note: message ? redact(message).slice(0, 300) : undefined }) };
    appendFileSync(f, JSON.stringify(entry) + "\n");
    if (statSync(f).size > MAX_BYTES) {
      const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
      writeFileSync(f, lines.slice(-KEEP_LINES).join("\n") + "\n");
    }
  } catch {
    /* reliability tracking must never break a real generation */
  }
}

export function readReliability(home: string): ProviderEvent[] {
  const f = reliabilityPath(home);
  if (!existsSync(f)) return [];
  const out: ProviderEvent[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ProviderEvent;
      if (e && typeof e.provider === "string" && typeof e.ok === "boolean") out.push(e);
    } catch {
      /* skip a damaged line */
    }
  }
  return out;
}

export interface Health {
  provider: string;
  recent: number;
  failures: number;
  streak: number;
  streakClass?: FailureClass;
  note?: string;
}

/** Looks at the most recent events for one provider and says whether there's a real pattern worth a human's attention. */
export function providerHealth(events: ProviderEvent[], provider: string): Health {
  const recent = events.filter((e) => e.provider === provider).slice(-STREAK_WINDOW);
  let streak = 0;
  let streakClass: FailureClass | undefined;
  for (let i = recent.length - 1; i >= 0; i--) {
    const e = recent[i];
    if (e.ok) break;
    if (streak === 0) streakClass = e.cls;
    else if (e.cls !== streakClass) break;
    streak++;
  }
  const failures = recent.filter((e) => !e.ok).length;
  const note =
    streak >= STREAK_THRESHOLD
      ? `${provider} has failed its last ${streak} calls in a row (${streakClass}). This looks like a real problem, not a one-off; a site redesign can break a selector like this.`
      : undefined;
  return { provider, recent: recent.length, failures, streak, streakClass, note };
}
