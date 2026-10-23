import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { isInside } from "./safety.js";

/**
 * Draft housekeeping. Every generation lands in <project>/.ai-media. Without cleanup that folder grows forever
 * with rejected attempts. This keeps a small status for each draft and removes old ones after a grace period.
 *
 * Safety rules, on purpose strict:
 * - Only files inside <project>/.ai-media are ever considered. Final assets in the project are never touched.
 * - Only real files with a media extension. Symbolic links and junctions are skipped, never followed.
 * - .ai-media itself must be a real folder inside the project. If it is a link or junction (a cloned repo can
 *   ship one), nothing is read, written or deleted through it.
 * - A draft marked "used" is only removed when the final file it produced still exists.
 * - Nothing is deleted when dry_run is true, and the result lists exactly what would go and how many bytes it frees.
 */
export type DraftStatus = "draft" | "shortlisted" | "rejected" | "used";

export interface StatusEntry {
  status: DraftStatus;
  updated: string;
  note?: string;
  /** For "used": the project-relative path of the file that was made from this draft. */
  final?: string;
}

export interface Days {
  rejected: number;
  used: number;
  draft: number;
  shortlisted: number;
}

export const DEFAULT_DAYS: Days = { rejected: 3, used: 14, draft: 30, shortlisted: 60 };

const MEDIA = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov"]);
const SKIP_NAMES = new Set(["manifest.jsonl", "status.json", "presets.json", ".gitignore"]);
const DAY = 86_400_000;

const key = (root: string, file: string) => relative(root, file).split(sep).join("/");

export function mediaDirOf(root: string): string {
  return join(root, ".ai-media");
}

/**
 * True when <root>/.ai-media is missing or a real directory inside the project. False when it is a symbolic
 * link, a junction, a file, or resolves anywhere else: following it would let cleanup delete the user's own
 * files elsewhere on the disk.
 */
export function mediaDirIsSafe(root: string): boolean {
  const dir = mediaDirOf(root);
  let st;
  try {
    st = lstatSync(dir, { throwIfNoEntry: false });
  } catch {
    return false;
  }
  if (!st) return true;
  if (st.isSymbolicLink() || !st.isDirectory()) return false;
  try {
    return isInside(realpathSync(dir), realpathSync(root));
  } catch {
    return false;
  }
}

/**
 * A bookkeeping file in .ai-media (status.json, manifest.jsonl, .gitignore) that may be read or written:
 * missing, or a plain file with a single name. A repo can commit a link there, and writing through it would
 * overwrite or append to whatever file it points at.
 */
export function plainOrMissing(file: string): boolean {
  try {
    const st = lstatSync(file, { throwIfNoEntry: false });
    return !st || (st.isFile() && st.nlink <= 1);
  } catch {
    return false;
  }
}

export const UNSAFE_MEDIA_DIR = "<project>/.ai-media (or a bookkeeping file in it) is a link or junction, not a real folder or file. Nothing is read, written or deleted through it. Remove the link and try again.";

export function readStatus(root: string): Record<string, StatusEntry> {
  const f = join(mediaDirOf(root), "status.json");
  try {
    return existsSync(f) && plainOrMissing(f) ? (JSON.parse(readFileSync(f, "utf8")) as Record<string, StatusEntry>) : {};
  } catch {
    return {};
  }
}

function writeStatus(root: string, data: Record<string, StatusEntry>) {
  const dir = mediaDirOf(root);
  if (!existsSync(dir) || !mediaDirIsSafe(root) || !plainOrMissing(join(dir, "status.json"))) return;
  writeFileSync(join(dir, "status.json"), JSON.stringify(data, null, 1));
}

/** Record what happened to a draft. Paths outside .ai-media are ignored. */
export function markDraft(root: string, file: string, entry: Omit<StatusEntry, "updated">, now = Date.now()): boolean {
  const k = key(root, file);
  if (!k.startsWith(".ai-media/") || k.includes("..")) return false;
  const all = readStatus(root);
  all[k] = { ...entry, updated: new Date(now).toISOString() };
  writeStatus(root, all);
  return true;
}

export interface Removal {
  file: string;
  bytes: number;
  why: string;
}

export interface CleanupResult {
  dryRun: boolean;
  removed: Removal[];
  freedBytes: number;
  kept: number;
}

function walk(dir: string, depth: number, out: string[]) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(".") || SKIP_NAMES.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = lstatSync(p);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) {
      if (depth < 3) walk(p, depth + 1, out);
    } else if (st.isFile() && MEDIA.has(extname(name).toLowerCase())) out.push(p);
  }
}

function pruneEmptyDirs(dir: string, base: string) {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) {
    const p = join(dir, n);
    try {
      if (lstatSync(p).isDirectory() && !lstatSync(p).isSymbolicLink()) pruneEmptyDirs(p, base);
    } catch {
      /* ignore */
    }
  }
  if (dir !== base) {
    try {
      if (readdirSync(dir).length === 0) rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
}

export function cleanup(root: string, opts: { days?: Partial<Days>; dryRun?: boolean; now?: number } = {}): CleanupResult {
  // A day count left undefined (the tool's optional arguments) keeps its default instead of disabling the rule.
  const given = Object.fromEntries(Object.entries(opts.days ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v)));
  const days: Days = { ...DEFAULT_DAYS, ...given };
  const now = opts.now ?? Date.now();
  const dryRun = opts.dryRun ?? true;
  const base = mediaDirOf(root);
  const result: CleanupResult = { dryRun, removed: [], freedBytes: 0, kept: 0 };
  if (!existsSync(base) && !lstatSync(base, { throwIfNoEntry: false })) return result;
  if (!mediaDirIsSafe(root)) throw new Error(UNSAFE_MEDIA_DIR);
  const status = readStatus(root);
  const files: string[] = [];
  walk(base, 0, files);

  for (const file of files) {
    const k = key(root, file);
    const st = statSync(file);
    const entry = status[k];
    let why: string | undefined;
    const ageSince = (iso?: string) => (now - (iso ? Date.parse(iso) || st.mtimeMs : st.mtimeMs)) / DAY;

    if (entry?.status === "rejected") {
      if (ageSince(entry.updated) >= days.rejected) why = `rejected draft older than ${days.rejected} days`;
    } else if (entry?.status === "used" && entry.final && !entry.final.includes("..") && existsSync(join(root, entry.final))) {
      if (ageSince(entry.updated) >= days.used) why = `draft already used (final file exists), older than ${days.used} days`;
    } else if (entry?.status === "shortlisted") {
      if (ageSince(undefined) >= days.shortlisted) why = `shortlisted draft not used for ${days.shortlisted} days`;
    } else if (ageSince(undefined) >= days.draft) {
      why = `unused draft older than ${days.draft} days`;
    }

    if (!why) {
      result.kept++;
      continue;
    }
    result.removed.push({ file: k, bytes: st.size, why });
    result.freedBytes += st.size;
    if (!dryRun) {
      try {
        unlinkSync(file);
        delete status[k];
      } catch {
        result.removed.pop();
        result.freedBytes -= st.size;
        result.kept++;
      }
    }
  }
  if (!dryRun && result.removed.length) {
    writeStatus(root, status);
    pruneEmptyDirs(base, base);
  }
  return result;
}

const done = new Set<string>();

/** Runs at most once per server process and project. Never throws: housekeeping must not break a generation. */
export function autoCleanup(root: string, enabled: boolean): CleanupResult | undefined {
  if (!enabled || done.has(root)) return undefined;
  done.add(root);
  try {
    const r = cleanup(root, { dryRun: false });
    return r.removed.length ? r : undefined;
  } catch {
    return undefined;
  }
}

/** For tests. */
export function resetAutoCleanup() {
  done.clear();
}
