import { ff } from "./optimize.js";

/**
 * Lays several draft images out on one grid so they can be compared side by side instead of one at a time.
 * No text is drawn onto the image (drawtext needs a font file ffmpeg can find, which isn't guaranteed on
 * every machine this runs on); the tool result instead returns which grid position holds which file, in
 * reading order (left to right, top to bottom), so the caller can say "tile 3 is the gold version" itself.
 */

export const MAX_ITEMS = 12;
const TILE_W = 480;
const TILE_H = 480;
const GAP = 12;
const BG = "0x0b1020";

export function gridFor(n: number, cols?: number): { cols: number; rows: number } {
  const c = cols && cols > 0 ? cols : Math.ceil(Math.sqrt(n));
  return { cols: c, rows: Math.ceil(n / c) };
}

export interface ContactSheetResult {
  cols: number;
  rows: number;
  width: number;
  height: number;
  tiles: { index: number; file: string }[];
}

export async function contactSheet(files: string[], outPath: string, cols?: number): Promise<ContactSheetResult> {
  if (!files.length) throw new Error("contact_sheet needs at least one image");
  if (files.length > MAX_ITEMS) throw new Error(`contact_sheet supports at most ${MAX_ITEMS} images at once`);

  const grid = gridFor(files.length, cols);
  const width = grid.cols * TILE_W + (grid.cols + 1) * GAP;
  const height = grid.rows * TILE_H + (grid.rows + 1) * GAP;

  const inputs = files.flatMap((f) => ["-i", f]);
  const scaled = files.map(
    (_, i) => `[${i}:v]scale=${TILE_W}:${TILE_H}:force_original_aspect_ratio=decrease,pad=${TILE_W}:${TILE_H}:(ow-iw)/2:(oh-ih)/2:color=${BG}[t${i}]`,
  );
  const layout = files
    .map((_, i) => {
      const col = i % grid.cols;
      const row = Math.floor(i / grid.cols);
      return `${col * TILE_W + (col + 1) * GAP}_${row * TILE_H + (row + 1) * GAP}`;
    })
    .join("|");
  const stack = `${files.map((_, i) => `[t${i}]`).join("")}xstack=inputs=${files.length}:layout=${layout}:fill=${BG}[out]`;

  await ff(["-y", ...inputs, "-filter_complex", `${scaled.join(";")};${stack}`, "-map", "[out]", "-frames:v", "1", outPath]);

  return { cols: grid.cols, rows: grid.rows, width, height, tiles: files.map((file, index) => ({ index: index + 1, file })) };
}
