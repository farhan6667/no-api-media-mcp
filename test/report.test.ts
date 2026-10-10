import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { usageReport, type ManifestEntry } from "../src/report.js";

const entry = (over: Partial<ManifestEntry>): ManifestEntry => ({
  time: "2026-10-10T00:00:00.000Z",
  provider: "codex",
  file: "a.png",
  bytes: 1000,
  mime: "image/png",
  prompt: "x",
  ...over,
});

describe("usageReport", () => {
  it("totals files and bytes across providers and mime types", () => {
    const r = usageReport([
      entry({ provider: "codex", mime: "image/png", bytes: 100 }),
      entry({ provider: "codex", mime: "image/jpeg", bytes: 200 }),
      entry({ provider: "flow", mime: "image/jpeg", bytes: 300 }),
    ]);
    assert.equal(r.total, 3);
    assert.equal(r.totalBytes, 600);
    assert.deepEqual(r.byProvider, { codex: 2, flow: 1 });
    assert.deepEqual(r.byMime, { "image/png": 1, "image/jpeg": 2 });
  });

  it("groups by calendar day", () => {
    const r = usageReport([entry({ time: "2026-10-01T09:00:00.000Z" }), entry({ time: "2026-10-01T18:00:00.000Z" }), entry({ time: "2026-10-02T09:00:00.000Z" })]);
    assert.deepEqual(r.byDay, { "2026-10-01": 2, "2026-10-02": 1 });
  });

  it("an empty manifest reports zero, not an error", () => {
    const r = usageReport([]);
    assert.equal(r.total, 0);
    assert.equal(r.since, undefined);
  });

  it("since_days scopes to recent entries only", () => {
    const now = Date.now();
    const old = new Date(now - 40 * 86_400_000).toISOString();
    const recent = new Date(now - 1 * 86_400_000).toISOString();
    const r = usageReport([entry({ time: old }), entry({ time: recent })], 7);
    assert.equal(r.total, 1);
  });
});
