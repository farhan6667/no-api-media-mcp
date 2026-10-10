import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { cssVariables, type DominantColor } from "../src/palette.js";

const colors: DominantColor[] = [
  { hex: "#0b1020", weight: 0.6 },
  { hex: "#00d1ff", weight: 0.25 },
  { hex: "#ffffff", weight: 0.15 },
];

describe("cssVariables", () => {
  it("orders variables most to least dominant and names them by position, not a guessed role", () => {
    const css = cssVariables(colors);
    assert.match(css, /:root \{/);
    assert.match(css, /--palette-1: #0b1020;/);
    assert.match(css, /--palette-2: #00d1ff;/);
    assert.match(css, /--palette-3: #ffffff;/);
  });

  it("accepts a custom prefix", () => {
    const css = cssVariables(colors, "hero");
    assert.match(css, /--hero-1: #0b1020;/);
  });
});
