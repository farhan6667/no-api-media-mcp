import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { gridFor, MAX_ITEMS } from "../src/contact-sheet.js";

describe("gridFor", () => {
  it("picks a roughly square grid by default", () => {
    assert.deepEqual(gridFor(1), { cols: 1, rows: 1 });
    assert.deepEqual(gridFor(4), { cols: 2, rows: 2 });
    assert.deepEqual(gridFor(9), { cols: 3, rows: 3 });
  });
  it("rounds up rows when the count doesn't fit evenly", () => {
    assert.deepEqual(gridFor(5), { cols: 3, rows: 2 });
    assert.deepEqual(gridFor(7), { cols: 3, rows: 3 });
  });
  it("respects an explicit column count", () => {
    assert.deepEqual(gridFor(7, 2), { cols: 2, rows: 4 });
    assert.deepEqual(gridFor(6, 6), { cols: 6, rows: 1 });
  });
  it("caps at a sane number of images", () => {
    assert.equal(MAX_ITEMS, 12);
  });
});
