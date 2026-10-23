import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoInstall, checkForUpdate, isNewer, updateNotice, type Fetcher } from "../src/update.js";

function okFetcher(body: unknown, status = 200): Fetcher {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
}
function failFetcher(err: unknown): Fetcher {
  return async () => {
    throw err;
  };
}
function slowFetcher(ms: number): Fetcher {
  return (_url, init) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ ok: true, status: 200, text: async () => "{}" }), ms);
      init.signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new Error("aborted"));
      });
    });
}

describe("isNewer", () => {
  it("compares semver numerically, not as strings", () => {
    assert.equal(isNewer("1.10.0", "1.9.0"), true);
    assert.equal(isNewer("1.9.0", "1.10.0"), false);
    assert.equal(isNewer("2.0.0", "1.99.99"), true);
    assert.equal(isNewer("1.0.0", "1.0.0"), false);
    assert.equal(isNewer("v0.6.0", "0.5.0"), true);
  });

  it("never claims newer for unparsable input", () => {
    assert.equal(isNewer("not-a-version", "0.5.0"), false);
    assert.equal(isNewer("0.5.0", "also-bad"), false);
    assert.equal(isNewer("", ""), false);
  });
});

describe("checkForUpdate", () => {
  const opts = (fetcher: Fetcher, extra: Partial<Parameters<typeof checkForUpdate>[1]> = {}) => ({ currentVersion: "0.5.0", intervalHours: 24, fetcher, now: Date.UTC(2026, 9, 10), ...extra });

  it("finds a newer release and persists what it saw", async () => {
    const r = await checkForUpdate({}, opts(okFetcher({ tag_name: "v0.6.0", name: "0.6.0: learning", html_url: "https://github.com/farhan6667/no-api-media-mcp/releases/tag/v0.6.0" })));
    assert.equal(r.release?.version, "0.6.0");
    assert.equal(r.release?.name, "0.6.0: learning");
    assert.equal(r.state.lastSeenVersion, "0.6.0");
    assert.ok(r.state.lastCheckedAt);
  });

  it("reports nothing when already current", async () => {
    const r = await checkForUpdate({}, opts(okFetcher({ tag_name: "v0.5.0", name: "current" })));
    assert.equal(r.release, undefined);
  });

  it("does not re-check inside the interval, but still reports a previously seen newer version", async () => {
    let called = false;
    const spy: Fetcher = async (...a) => {
      called = true;
      return okFetcher({ tag_name: "v9.9.9", name: "x" })(...a);
    };
    const recent = new Date(Date.UTC(2026, 9, 10) - 60_000).toISOString();
    const r = await checkForUpdate({ lastCheckedAt: recent, lastSeenVersion: "0.9.0" }, opts(spy));
    assert.equal(called, false);
    assert.equal(r.release?.version, "0.9.0");
    assert.equal(r.state.lastCheckedAt, recent);
  });

  it("checks again once the interval has elapsed", async () => {
    let called = false;
    const spy: Fetcher = async (...a) => {
      called = true;
      return okFetcher({ tag_name: "v0.7.0", name: "x" })(...a);
    };
    const old = new Date(Date.UTC(2026, 9, 1)).toISOString();
    const r = await checkForUpdate({ lastCheckedAt: old, lastSeenVersion: "0.6.0" }, opts(spy));
    assert.equal(called, true);
    assert.equal(r.release?.version, "0.7.0");
  });

  it("never throws on a network failure, a timeout, a 404, or garbage JSON", async () => {
    for (const fetcher of [failFetcher(new Error("DNS fail")), okFetcher({}, 404), okFetcher("not json"), slowFetcher(50)]) {
      const r = await checkForUpdate({}, opts(fetcher, { timeoutMs: 10 } as never));
      assert.equal(r.release, undefined, String(fetcher));
    }
  });

  it("caps an oversized response instead of parsing it", async () => {
    const huge: Fetcher = async () => ({ ok: true, status: 200, text: async () => "x".repeat(300_000) });
    const r = await checkForUpdate({}, opts(huge));
    assert.equal(r.release, undefined);
  });

  it("only trusts a release URL on this project's own repo", async () => {
    const r = await checkForUpdate({}, opts(okFetcher({ tag_name: "v0.6.0", name: "x", html_url: "https://evil.example/x" })));
    assert.equal(r.release?.url, "https://github.com/farhan6667/no-api-media-mcp/releases/latest");
  });

  it("an infinite interval (updates disabled) never calls the network", async () => {
    let called = false;
    const spy: Fetcher = async (...a) => {
      called = true;
      return okFetcher({ tag_name: "v9.9.9", name: "x" })(...a);
    };
    await checkForUpdate({}, opts(spy, { intervalHours: Number.POSITIVE_INFINITY }));
    assert.equal(called, false);
  });
});

describe("updateNotice", () => {
  const rel = { version: "0.6.0", name: "Learning release", url: "https://github.com/farhan6667/no-api-media-mcp/releases/tag/v0.6.0" };
  it("for an npm install: names the real version, the npm command, and both toggles", () => {
    const text = updateNotice(rel, "0.5.0", true);
    assert.match(text, /v0\.6\.0/);
    assert.match(text, /v0\.5\.0/);
    assert.match(text, /npm install -g no-api-media-mcp@latest/);
    assert.match(text, /NOAPI_CHECK_UPDATES=0/);
    assert.match(text, /NOAPI_AUTO_UPDATE=1/);
  });
  it("for a git checkout: never suggests npm (the package name may belong to someone else there)", () => {
    const text = updateNotice(rel, "0.5.0", false);
    assert.match(text, /git pull/);
    assert.doesNotMatch(text, /npm install -g/);
    assert.doesNotMatch(text, /NOAPI_AUTO_UPDATE/);
  });
});

describe("release versions handed to npm", () => {
  it("only plain release versions from GitHub are accepted", async () => {
    for (const tag of ["v9.9.9#github:attacker/repo", "file:../evil", "github:attacker/repo", "latest", "1.2", "1.2.3 --registry=http://x", "1.2.3-a/b"]) {
      const r = await checkForUpdate({}, { currentVersion: "1.0.0", intervalHours: 0, now: 1, fetcher: okFetcher({ tag_name: tag, name: "x" }) });
      assert.equal(r.release, undefined, tag);
    }
    const ok = await checkForUpdate({}, { currentVersion: "1.0.0", intervalHours: 0, now: 1, fetcher: okFetcher({ tag_name: "v1.5.0", name: "x" }) });
    assert.equal(ok.release?.version, "1.5.0");
  });
});

describe("autoInstall", () => {
  // These never reach the npm registry: a real `npm install -g` from a test would run whatever is
  // published under that name by anyone, on every CI runner.
  it("never touches a git checkout", async () => {
    const r = await autoInstall("1.5.0", { fromNpm: false, npmCli: "/must/not/run" });
    assert.equal(r.ok, false);
    assert.match(r.detail, /git checkout/);
  });
  it("refuses anything but a plain version, before running anything", async () => {
    for (const v of ["github:attacker/repo", "file:../x", "1.2.3 --registry=http://evil", "latest"]) {
      const r = await autoInstall(v, { fromNpm: true, npmCli: "/must/not/run" });
      assert.equal(r.ok, false);
      assert.match(r.detail, /not a plain release version/);
    }
  });
  it("reports failure honestly and never throws when npm's script is missing", async () => {
    const r = await autoInstall("1.5.0", { fromNpm: true, npmCli: join(tmpdir(), "no-such-npm-cli.js") });
    assert.equal(r.ok, false);
    assert.equal(typeof r.detail, "string");
  });
});
