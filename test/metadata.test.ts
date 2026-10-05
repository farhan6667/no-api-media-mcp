import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { resolveStrip } from "../src/config.js";
import { container, inspectMetadata, labels, mp4Boxes, pngDimensions, stripMetadata } from "../src/metadata.js";
import { ffmpegPath, optimizeImage } from "../src/optimize.js";

// ---------- fixture builders (real, decodable files with planted metadata) ----------

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** A valid 4x4 RGBA PNG with a planted C2PA (caBX) chunk, a prompt in tEXt and XMP in iTXt. */
function fixturePng(withMeta = true): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows: Buffer[] = [];
  for (let y = 0; y < 4; y++) {
    const row = Buffer.alloc(1 + 16);
    for (let x = 0; x < 4; x++) row.set([40 + x * 50, 90 + y * 40, 200, 255], 1 + x * 4);
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows));
  const meta = withMeta
    ? [
        pngChunk("caBX", Buffer.from("\0\0\0\x20jumbc2pa fake manifest for tests", "latin1")),
        pngChunk("tEXt", Buffer.from("prompt\0a secret prompt", "latin1")),
        pngChunk("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0<x:xmpmeta/>", "latin1")),
      ]
    : [];
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...meta,
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function jpegSeg(marker: number, data: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(data.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, data]);
}
/** Not decodable (no real scan) but structurally a JPEG: enough to test segment handling. */
function fixtureJpeg(): { buf: Buffer; tail: Buffer } {
  const tail = Buffer.concat([Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0]), Buffer.from([1, 2, 0xff, 0x00, 3, 4]), Buffer.from([0xff, 0xd9])]);
  const buf = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    jpegSeg(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    jpegSeg(0xe1, Buffer.from("Exif\0\0MM\0*", "latin1")),
    jpegSeg(0xe1, Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>", "latin1")),
    jpegSeg(0xe2, Buffer.from("ICC_PROFILE\0\x01\x01fake-icc", "latin1")),
    jpegSeg(0xeb, Buffer.from("JP\0\x01jumbf c2pa", "latin1")),
    jpegSeg(0xed, Buffer.from("Photoshop 3.0\x008BIM", "latin1")),
    jpegSeg(0xee, Buffer.from("Adobe\0d\0\0\0\0\x01", "latin1")),
    jpegSeg(0xfe, Buffer.from("made by a tool", "latin1")),
    jpegSeg(0xdb, Buffer.alloc(65, 1)),
    tail,
  ]);
  return { buf, tail };
}

function riff(fourcc: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32LE(data.length);
  return Buffer.concat([Buffer.from(fourcc, "latin1"), size, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}
function fixtureWebp(): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x10 | 0x08 | 0x04; // alpha + EXIF + XMP flags
  const body = Buffer.concat([
    riff("VP8X", vp8x),
    riff("ICCP", Buffer.from("fake icc")),
    riff("VP8L", Buffer.from([0x2f, 1, 2, 3, 4, 5, 6])), // odd size: tests padding
    riff("EXIF", Buffer.from("MM\0*exif")),
    riff("XMP ", Buffer.from("<x:xmpmeta/>")),
    riff("C2PA", Buffer.from("jumb manifest")),
  ]);
  const head = Buffer.alloc(12);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(4 + body.length, 4);
  head.write("WEBP", 8, "ascii");
  return Buffer.concat([head, body]);
}

function box(type: string, data: Buffer): Buffer {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(8 + data.length);
  return Buffer.concat([size, Buffer.from(type, "latin1"), data]);
}
const C2PA_UUID = Buffer.from("d8fec3d61b0e483c92975828877ec481", "hex");
function fixtureMp4(uuidAtEnd: boolean): Buffer {
  const parts = [box("ftyp", Buffer.from("isom\0\0\0\0isom")), box("moov", Buffer.alloc(16, 7)), box("mdat", Buffer.alloc(32, 9))];
  const uuid = box("uuid", Buffer.concat([C2PA_UUID, Buffer.from("manifest")]));
  return Buffer.concat(uuidAtEnd ? [...parts, uuid] : [parts[0], uuid, parts[1], parts[2]]);
}

// ---------- tests ----------

describe("PNG metadata", () => {
  const png = fixturePng();
  it("finds C2PA, XMP and text chunks", () => {
    const l = labels(inspectMetadata(png).items);
    assert.equal(container(png), "png");
    assert.ok(l.includes("C2PA manifest (PNG caBX)"), l.join());
    assert.ok(l.includes("XMP (PNG iTXt)"));
    assert.ok(l.some((x) => x.startsWith("text metadata (PNG tEXt")));
  });
  it("strips them, keeps pixels, dimensions and structure", () => {
    const r = stripMetadata(png);
    assert.equal(r.removed.length, 3);
    assert.equal(inspectMetadata(r.out).items.length, 0);
    assert.deepEqual(pngDimensions(r.out), { width: 4, height: 4 });
    assert.ok(!r.out.includes("secret prompt"));
    assert.ok(!r.out.includes("caBX"));
    assert.ok(r.out.includes("IDAT") && r.out.includes("IEND"));
    // Byte-identical to the same image built without metadata.
    assert.ok(r.out.equals(fixturePng(false)));
  });
  it("is a no-op on a clean file", () => {
    const clean = fixturePng(false);
    const r = stripMetadata(clean);
    assert.equal(r.removed.length, 0);
    assert.ok(r.out.equals(clean));
  });
});

describe("JPEG metadata", () => {
  const { buf, tail } = fixtureJpeg();
  it("finds EXIF, XMP, JUMBF, Photoshop and comment segments", () => {
    const l = labels(inspectMetadata(buf).items);
    assert.deepEqual(l.sort(), ["C2PA / JUMBF manifest (JPEG APP11)", "EXIF (JPEG APP1)", "Photoshop / IPTC block (JPEG APP13)", "XMP (JPEG APP1)", "comment (JPEG COM)"].sort());
  });
  it("strips them but keeps JFIF, ICC, Adobe and tables, and the scan untouched", () => {
    const r = stripMetadata(buf);
    const out = r.out;
    assert.equal(inspectMetadata(out).items.length, 0);
    assert.ok(out.includes("JFIF") && out.includes("ICC_PROFILE") && out.includes("Adobe"));
    assert.ok(!out.includes("Exif") && !out.includes("xmpmeta") && !out.includes("8BIM") && !out.includes("made by a tool"));
    assert.ok(out.subarray(out.length - tail.length).equals(tail));
  });
});

describe("WebP metadata", () => {
  const webp = fixtureWebp();
  it("finds EXIF, XMP and C2PA chunks", () => {
    assert.deepEqual(labels(inspectMetadata(webp).items).sort(), ["C2PA manifest (WebP)", "EXIF (WebP)", "XMP (WebP)"]);
  });
  it("strips them, fixes the RIFF size and clears the VP8X flags", () => {
    const out = stripMetadata(webp).out;
    assert.equal(inspectMetadata(out).items.length, 0);
    assert.equal(out.readUInt32LE(4), out.length - 8);
    assert.equal(out[12 + 8], 0x10, "only the alpha flag should remain");
    assert.ok(out.includes("ICCP") && out.includes("VP8L"));
  });
});

describe("MP4 C2PA uuid box", () => {
  it("is detected", () => {
    const l = labels(inspectMetadata(fixtureMp4(true)).items);
    assert.deepEqual(l, ["C2PA manifest (MP4 uuid box)"]);
  });
  it("is trimmed when it trails the media data", () => {
    const r = stripMetadata(fixtureMp4(true));
    assert.equal(r.needsRemux, undefined);
    assert.deepEqual(mp4Boxes(r.out).map((b) => b.type), ["ftyp", "moov", "mdat"]);
  });
  it("asks for a re-mux when it sits before the media data (offsets would shift)", () => {
    const r = stripMetadata(fixtureMp4(false));
    assert.equal(r.needsRemux, true);
    assert.equal(r.removed.length, 0);
  });
});

describe("strip setting precedence", () => {
  it("defaults to on", () => assert.equal(resolveStrip({}, {}), true));
  it("config.json can turn it off", () => {
    assert.equal(resolveStrip({ strip_ai_metadata: false }, {}), false);
    assert.equal(resolveStrip({ strip_ai_metadata: "false" }, {}), false);
    assert.equal(resolveStrip({ strip_ai_metadata: true }, {}), true);
  });
  it("the environment wins over config.json", () => {
    assert.equal(resolveStrip({ strip_ai_metadata: true }, { NO_API_MEDIA_KEEP_METADATA: "1" }), false);
    assert.equal(resolveStrip({ strip_ai_metadata: true }, { NOAPI_KEEP_METADATA: "true" }), false);
    assert.equal(resolveStrip({ strip_ai_metadata: false }, { NO_API_MEDIA_KEEP_METADATA: "0" }), false);
    assert.equal(resolveStrip({}, { NO_API_MEDIA_KEEP_METADATA: "0" }), true);
  });
});

describe("media_optimize end to end (needs ffmpeg)", () => {
  const dir = mkdtempSync(join(tmpdir(), "aam-meta-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const hasFfmpeg = (() => {
    try {
      return spawnSync(ffmpegPath(), ["-version"], { windowsHide: true }).status === 0;
    } catch {
      return false;
    }
  })();

  it("stripped output carries no metadata, keeps the size and decodes", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const input = join(dir, "in.png");
    writeFileSync(input, fixturePng());
    const out = join(dir, "out.webp");
    const r = await optimizeImage(input, out, undefined, 0.9, true);
    assert.equal(r.metadata.stripped, true);
    assert.ok(r.metadata.removed.includes("C2PA manifest (PNG caBX)"), r.metadata.removed.join());
    assert.deepEqual(r.metadata.kept, []);
    const probe = spawnSync(ffmpegPath().replace(/ffmpeg(\.exe)?$/i, "ffprobe$1"), ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out], { encoding: "utf8", windowsHide: true });
    assert.equal(probe.stdout.trim(), "4,4");
    assert.equal(inspectMetadata(readFileSync(out)).items.length, 0);
  });

  it("keep_metadata is honest about what re-encoding drops", { skip: !hasFfmpeg && "ffmpeg not installed" }, async () => {
    const input = join(dir, "in2.png");
    writeFileSync(input, fixturePng());
    const r = await optimizeImage(input, join(dir, "out2.webp"), undefined, 0.9, false);
    assert.equal(r.metadata.stripped, false);
    assert.match(r.metadata.note ?? "", /nothing was stripped on purpose/);
  });

  it("c2patool, when installed, sees no manifest after stripping a real signed file", { skip: !process.env.NOAPI_C2PA_FIXTURE && "set NOAPI_C2PA_FIXTURE to a C2PA-signed image to run" }, () => {
    const c2pa = spawnSync("c2patool", ["--version"], { windowsHide: true });
    if (c2pa.status !== 0) return;
    const fixture = process.env.NOAPI_C2PA_FIXTURE!;
    assert.ok(existsSync(fixture));
    const before = spawnSync("c2patool", [fixture], { encoding: "utf8", windowsHide: true });
    assert.equal(before.status, 0, "fixture should carry a readable manifest");
    const out = join(dir, "stripped" + fixture.slice(fixture.lastIndexOf(".")));
    writeFileSync(out, stripMetadata(readFileSync(fixture)).out);
    const afterRun = spawnSync("c2patool", [out], { encoding: "utf8", windowsHide: true });
    assert.ok(afterRun.status !== 0 || /no claim|no manifest/i.test(afterRun.stdout + afterRun.stderr));
  });
});
