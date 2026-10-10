import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A local usage summary built from the project's own .ai-media/manifest.jsonl (the record save() already
 * writes for every generated file). Nothing here is uploaded; it just totals up what's already on disk so a
 * user can see what they've been generating and spending without digging through the manifest by hand.
 */
export interface ManifestEntry {
  time: string;
  provider: string;
  file: string;
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
  prompt: string;
}

export function manifestPath(root: string): string {
  return join(root, ".ai-media", "manifest.jsonl");
}

export function readManifest(root: string): ManifestEntry[] {
  const f = manifestPath(root);
  if (!existsSync(f)) return [];
  const out: ManifestEntry[] = [];
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as ManifestEntry;
      if (e && typeof e.provider === "string" && typeof e.time === "string") out.push(e);
    } catch {
      /* skip a damaged line */
    }
  }
  return out;
}

export interface UsageReport {
  total: number;
  totalBytes: number;
  byProvider: Record<string, number>;
  byMime: Record<string, number>;
  byDay: Record<string, number>;
  since?: string;
  until?: string;
}

export function usageReport(entries: ManifestEntry[], sinceDays?: number): UsageReport {
  const cutoff = sinceDays ? Date.now() - sinceDays * 86_400_000 : undefined;
  const scoped = cutoff === undefined ? entries : entries.filter((e) => new Date(e.time).getTime() >= cutoff);
  const byProvider: Record<string, number> = {};
  const byMime: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let totalBytes = 0;
  for (const e of scoped) {
    byProvider[e.provider] = (byProvider[e.provider] ?? 0) + 1;
    byMime[e.mime] = (byMime[e.mime] ?? 0) + 1;
    const day = e.time.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
    totalBytes += e.bytes ?? 0;
  }
  return {
    total: scoped.length,
    totalBytes,
    byProvider,
    byMime,
    byDay,
    since: scoped.length ? scoped[0].time : undefined,
    until: scoped.length ? scoped[scoped.length - 1].time : undefined,
  };
}
