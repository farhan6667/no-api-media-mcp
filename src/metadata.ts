/**
 * Embedded metadata: find it and strip it, byte by byte, with no decoder in the loop.
 *
 * Covers what AI image and video tools embed: C2PA manifests (PNG caBX, JPEG APP11/JUMBF, WebP C2PA,
 * MP4 uuid box), EXIF, XMP, Photoshop/IPTC blocks and text chunks. Pixels and the colour profile are
 * untouched, so the picture renders exactly the same.
 *
 * This is metadata only. Invisible watermarks such as Google SynthID live in the pixels and are not
 * touched, by design.
 */

export type Container = "png" | "jpeg" | "webp" | "mp4" | "other";

export interface MetaItem {
  /** Human label, e.g. "C2PA manifest (PNG caBX)". */
  label: string;
  /** Raw identifier: chunk type, APP marker, RIFF fourcc, or box type. */
  id: string;
  bytes: number;
}

export interface Inspection {
  container: Container;
  items: MetaItem[];
}

const C2PA_UUID = Buffer.from("d8fec3d61b0e483c92975828877ec481", "hex");
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function container(buf: Buffer): Container {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "mp4";
  return "other";
}

// ---------- PNG ----------

interface PngChunk {
  type: string;
  start: number;
  end: number;
  dataStart: number;
  length: number;
}

function pngChunks(buf: Buffer): PngChunk[] {
  const out: PngChunk[] = [];
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const end = pos + 12 + length;
    if (end > buf.length) break;
    out.push({ type, start: pos, end, dataStart: pos + 8, length });
    if (type === "IEND") break;
    pos = end;
  }
  return out;
}

const PNG_STRIP = new Set(["caBX", "iTXt", "tEXt", "zTXt", "eXIf"]);

function pngLabel(buf: Buffer, c: PngChunk): string {
  if (c.type === "caBX") return "C2PA manifest (PNG caBX)";
  if (c.type === "eXIf") return "EXIF (PNG eXIf)";
  const keyword = buf.toString("latin1", c.dataStart, Math.min(c.dataStart + 80, c.dataStart + c.length)).split("\0")[0];
  if (c.type === "iTXt" && keyword === "XML:com.adobe.xmp") return "XMP (PNG iTXt)";
  return `text metadata (PNG ${c.type} "${keyword.slice(0, 40)}")`;
}

export function pngDimensions(buf: Buffer): { width: number; height: number } | undefined {
  const ihdr = pngChunks(buf).find((c) => c.type === "IHDR");
  return ihdr ? { width: buf.readUInt32BE(ihdr.dataStart), height: buf.readUInt32BE(ihdr.dataStart + 4) } : undefined;
}

function inspectPng(buf: Buffer): MetaItem[] {
  return pngChunks(buf)
    .filter((c) => PNG_STRIP.has(c.type))
    .map((c) => ({ label: pngLabel(buf, c), id: c.type, bytes: c.end - c.start }));
}

function stripPng(buf: Buffer): Buffer {
  const chunks = pngChunks(buf);
  const keep = chunks.filter((c) => !PNG_STRIP.has(c.type));
  const parts = [buf.subarray(0, 8), ...keep.map((c) => buf.subarray(c.start, c.end))];
  // Anything after IEND (trailing junk) is dropped too.
  return Buffer.concat(parts);
}

// ---------- JPEG ----------

interface JpegSegment {
  marker: number;
  start: number;
  end: number;
  dataStart: number;
}

/** Segments up to and including the one before SOS. Everything from SOS on is entropy-coded data, copied as is. */
function jpegSegments(buf: Buffer): { segments: JpegSegment[]; sos: number } {
  const segments: JpegSegment[] = [];
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) break;
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos++; // fill byte
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      pos += 2; // standalone markers have no length
      continue;
    }
    if (marker === 0xda || marker === 0xd9) return { segments, sos: pos };
    const length = buf.readUInt16BE(pos + 2);
    const end = pos + 2 + length;
    if (end > buf.length) break;
    segments.push({ marker, start: pos, end, dataStart: pos + 4 });
    pos = end;
  }
  return { segments, sos: pos };
}

const JPEG_STRIP = new Set([0xe1, 0xeb, 0xed, 0xfe]); // APP1, APP11, APP13, COM

function jpegLabel(buf: Buffer, s: JpegSegment): string {
  const head = buf.toString("latin1", s.dataStart, Math.min(s.end, s.dataStart + 32));
  if (s.marker === 0xe1) {
    if (head.startsWith("Exif\0")) return "EXIF (JPEG APP1)";
    if (head.startsWith("http://ns.adobe.com/x")) return "XMP (JPEG APP1)";
    return "APP1 metadata (JPEG)";
  }
  if (s.marker === 0xeb) return "C2PA / JUMBF manifest (JPEG APP11)";
  if (s.marker === 0xed) return "Photoshop / IPTC block (JPEG APP13)";
  return "comment (JPEG COM)";
}

function inspectJpeg(buf: Buffer): MetaItem[] {
  return jpegSegments(buf)
    .segments.filter((s) => JPEG_STRIP.has(s.marker))
    .map((s) => ({ label: jpegLabel(buf, s), id: `APP${s.marker === 0xfe ? "COM" : s.marker - 0xe0}`, bytes: s.end - s.start }));
}

function stripJpeg(buf: Buffer): Buffer {
  const { segments, sos } = jpegSegments(buf);
  const keep = segments.filter((s) => !JPEG_STRIP.has(s.marker));
  return Buffer.concat([buf.subarray(0, 2), ...keep.map((s) => buf.subarray(s.start, s.end)), buf.subarray(sos)]);
}

// ---------- WebP ----------

interface RiffChunk {
  fourcc: string;
  start: number;
  end: number; // including pad byte
  dataStart: number;
  size: number;
}

function riffChunks(buf: Buffer): RiffChunk[] {
  const out: RiffChunk[] = [];
  let pos = 12;
  while (pos + 8 <= buf.length) {
    const fourcc = buf.toString("latin1", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const end = pos + 8 + size + (size % 2);
    if (pos + 8 + size > buf.length) break;
    out.push({ fourcc, start: pos, end: Math.min(end, buf.length), dataStart: pos + 8, size });
    pos = end;
  }
  return out;
}

const WEBP_STRIP = new Set(["EXIF", "XMP ", "C2PA", "JUMB"]);
const WEBP_LABEL: Record<string, string> = { EXIF: "EXIF (WebP)", "XMP ": "XMP (WebP)", C2PA: "C2PA manifest (WebP)", JUMB: "JUMBF manifest (WebP)" };

function inspectWebp(buf: Buffer): MetaItem[] {
  return riffChunks(buf)
    .filter((c) => WEBP_STRIP.has(c.fourcc))
    .map((c) => ({ label: WEBP_LABEL[c.fourcc], id: c.fourcc.trim(), bytes: c.end - c.start }));
}

function stripWebp(buf: Buffer): Buffer {
  const chunks = riffChunks(buf);
  const keep = chunks.filter((c) => !WEBP_STRIP.has(c.fourcc));
  const body = Buffer.concat(keep.map((c) => Buffer.from(buf.subarray(c.start, c.end))));
  // VP8X carries flags saying EXIF/XMP chunks exist; clear them so decoders don't go looking.
  let pos = 0;
  for (const c of keep) {
    if (c.fourcc === "VP8X") body[pos + 8] &= ~(0x08 | 0x04);
    pos += c.end - c.start;
  }
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}

// ---------- MP4 / MOV ----------

export interface Mp4Box {
  type: string;
  start: number;
  end: number;
  uuid?: string;
}

/** Top-level boxes only; C2PA lives in a top-level `uuid` box. */
export function mp4Boxes(buf: Buffer): Mp4Box[] {
  const out: Mp4Box[] = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    let size: number = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > buf.length) break;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = buf.length - pos;
    }
    if (size < header || pos + size > buf.length) break;
    const box: Mp4Box = { type, start: pos, end: pos + size };
    if (type === "uuid" && pos + header + 16 <= buf.length) box.uuid = buf.toString("hex", pos + header, pos + header + 16);
    out.push(box);
    pos += size;
  }
  return out;
}

function inspectMp4(buf: Buffer): MetaItem[] {
  return mp4Boxes(buf)
    .filter((b) => b.type === "uuid")
    .map((b) => ({
      label: b.uuid === C2PA_UUID.toString("hex") ? "C2PA manifest (MP4 uuid box)" : `uuid box ${b.uuid?.slice(0, 8)}… (MP4)`,
      id: "uuid",
      bytes: b.end - b.start,
    }));
}

/**
 * Drop top-level uuid boxes. Safe only when every uuid box sits after the last `mdat` and after `moov`,
 * because sample offsets inside moov point into mdat and would shift otherwise. Returns undefined when
 * it isn't safe; the caller then re-muxes with ffmpeg instead.
 */
function stripMp4(buf: Buffer): Buffer | undefined {
  const boxes = mp4Boxes(buf);
  const uuids = boxes.filter((b) => b.type === "uuid");
  if (!uuids.length) return buf;
  const lastData = Math.max(...boxes.filter((b) => b.type === "mdat" || b.type === "moov").map((b) => b.end), 0);
  if (uuids.some((u) => u.start < lastData)) return undefined;
  return Buffer.concat(boxes.filter((b) => b.type !== "uuid").map((b) => buf.subarray(b.start, b.end)));
}

// ---------- public API ----------

export function inspectMetadata(buf: Buffer): Inspection {
  const c = container(buf);
  const items = c === "png" ? inspectPng(buf) : c === "jpeg" ? inspectJpeg(buf) : c === "webp" ? inspectWebp(buf) : c === "mp4" ? inspectMp4(buf) : [];
  return { container: c, items };
}

export interface StripResult {
  out: Buffer;
  removed: MetaItem[];
  /** MP4 only: a uuid box sits before media data, so a container re-mux is needed instead of a byte trim. */
  needsRemux?: boolean;
}

export function stripMetadata(buf: Buffer): StripResult {
  const { container: c, items } = inspectMetadata(buf);
  if (!items.length) return { out: buf, removed: [] };
  if (c === "png") return { out: stripPng(buf), removed: items };
  if (c === "jpeg") return { out: stripJpeg(buf), removed: items };
  if (c === "webp") return { out: stripWebp(buf), removed: items };
  if (c === "mp4") {
    const out = stripMp4(buf);
    return out ? { out, removed: items } : { out: buf, removed: [], needsRemux: true };
  }
  return { out: buf, removed: [] };
}

export const labels = (items: MetaItem[]) => [...new Set(items.map((i) => i.label))];
