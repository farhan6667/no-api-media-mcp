import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { aheadOf, clearHost, formatEta, hostAlive, hostFile, joinQueue, leaveQueue, markHost, queueDir, waiting } from "../src/queue.js";

const home = mkdtempSync(join(tmpdir(), "noapi-queue-"));
after(() => rmSync(home, { recursive: true, force: true }));

describe("browser queue", () => {
  it("first in line has nobody ahead, and leaving removes the ticket", () => {
    const t = joinQueue(home, 1_700_000_000_000);
    assert.equal(aheadOf(t), 0);
    leaveQueue(t);
    assert.equal(existsSync(t), false);
  });

  it("counts only live, earlier tickets and cleans up dead ones", () => {
    const dir = queueDir(home);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "1700000000001-111-aaaaaa"), "");
    writeFileSync(join(dir, "1700000000002-222-bbbbbb"), "");
    writeFileSync(join(dir, "1700000000009-333-cccccc"), "");
    const me = join(dir, "1700000000005-444-dddddd");
    writeFileSync(me, "");
    const isAlive = (pid: number) => pid !== 222;
    assert.equal(aheadOf(me, isAlive), 1);
    assert.equal(existsSync(join(dir, "1700000000002-222-bbbbbb")), false);
    assert.equal(waiting(home, isAlive), 3);
    for (const f of ["1700000000001-111-aaaaaa", "1700000000009-333-cccccc", "1700000000005-444-dddddd"]) rmSync(join(dir, f), { force: true });
  });

  it("ignores files that aren't tickets", () => {
    const dir = queueDir(home);
    writeFileSync(join(dir, "notes.txt"), "");
    const t = joinQueue(home);
    assert.equal(aheadOf(t), 0);
    leaveQueue(t);
  });
});

describe("browser host marker", () => {
  it("marks this process as host, sees it alive, and clears only its own marker", () => {
    markHost(home);
    assert.equal(hostAlive(home), true);
    clearHost(home);
    assert.equal(existsSync(hostFile(home)), false);
  });

  it("a marker left by a dead process doesn't count as a live host", () => {
    writeFileSync(hostFile(home), "999999");
    assert.equal(hostAlive(home, () => false), false);
    clearHost(home);
    assert.equal(existsSync(hostFile(home)), true, "another process's marker is never removed by us");
    rmSync(hostFile(home));
  });
});

describe("formatEta", () => {
  it("says nothing without a real estimate", () => {
    assert.equal(formatEta(undefined), undefined);
    assert.equal(formatEta(0), undefined);
  });
  it("rounds to minutes", () => {
    assert.equal(formatEta(20_000), "under a minute");
    assert.equal(formatEta(3 * 60_000 + 10_000), "about 3 min");
  });
});
