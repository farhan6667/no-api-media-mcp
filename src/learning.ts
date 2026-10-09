import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AUDIT_PASS, AUDIT_RUBRIC } from "./design.js";

/**
 * The server learns from its own audits. Every design_audit is written to a small local journal
 * (<home>/journal.jsonl, never uploaded, never inside a project). design_brief reads it back and, for the kind of
 * asset being made, turns the criteria that keep scoring low into advice that goes into the prompt up front.
 * So a mistake that happens twice stops happening a third time.
 */
export interface JournalEntry {
  time: string;
  asset: string;
  scores: Record<string, number>;
  average: number;
  verdict: "ship" | "revise";
}

export interface Learned {
  criterion: string;
  average: number;
  seen: number;
  advice: string;
}

const MAX_BYTES = 200_000;
const KEEP_LINES = 300;
const WINDOW = 30;

export function journalPath(home: string): string {
  return join(home, "journal.jsonl");
}

export function readJournal(home: string): JournalEntry[] {
  const f = journalPath(home);
  if (!existsSync(f)) return [];
  const out: JournalEntry[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as JournalEntry;
      if (e && typeof e.asset === "string" && e.scores && typeof e.scores === "object") out.push(e);
    } catch {
      /* skip a damaged line */
    }
  }
  return out;
}

export function record(home: string, entry: Omit<JournalEntry, "time">, now = Date.now()) {
  try {
    const f = journalPath(home);
    mkdirSync(dirname(f), { recursive: true });
    const clean: Record<string, number> = {};
    for (const r of AUDIT_RUBRIC) {
      const v = entry.scores[r.id];
      if (typeof v === "number" && Number.isFinite(v)) clean[r.id] = Math.min(5, Math.max(0, v));
    }
    appendFileSync(f, JSON.stringify({ time: new Date(now).toISOString(), ...entry, scores: clean }) + "\n");
    if (statSync(f).size > MAX_BYTES) {
      const lines = readFileSync(f, "utf8").split("\n").filter(Boolean);
      writeFileSync(f, lines.slice(-KEEP_LINES).join("\n") + "\n");
    }
  } catch {
    /* learning must never break a tool call */
  }
}

/** Criteria that scored below the pass mark in at least two of the recent audits for this asset type. */
export function learnedFor(journal: JournalEntry[], asset: string): Learned[] {
  const same = journal.filter((e) => e.asset === asset).slice(-WINDOW);
  const pool = same.length >= 2 ? same : journal.slice(-WINDOW);
  const out: Learned[] = [];
  for (const c of AUDIT_RUBRIC) {
    const vals = pool.map((e) => e.scores[c.id]).filter((v): v is number => typeof v === "number");
    if (vals.length < 2) continue;
    const average = vals.reduce((a, b) => a + b, 0) / vals.length;
    if (average < AUDIT_PASS.average) out.push({ criterion: c.id, average: Math.round(average * 100) / 100, seen: vals.length, advice: c.fix });
  }
  return out.sort((a, b) => a.average - b.average).slice(0, 3);
}

/** One short sentence for the prompt, or undefined when there is nothing to learn yet. */
export function learnedSentence(l: Learned[]): string | undefined {
  if (!l.length) return undefined;
  return "Earlier results of this kind fell short on " + l.map((x) => `${x.criterion.replace(/-/g, " ")} (${x.advice.replace(/\.$/, "")})`).join("; ") + ". Get these right on the first try.";
}
