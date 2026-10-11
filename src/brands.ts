import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Brand } from "./design.js";

/**
 * Registered brands, so "which logo goes on this?" is answered once and never guessed again. A profile
 * says who publishes (a person posting as themselves, or a company), where the real logo files are for
 * dark and light backgrounds, and optionally the palette and fonts. design_brief takes a brand_id; the
 * compose tool uses the logo files. Stored in <home>/brands.json on this machine.
 */
export interface BrandProfile {
  id: string;
  name: string;
  publisher: "person" | "company";
  logo?: { dark?: string; light?: string };
  colors?: string[];
  fonts?: { heading: string; body: string; googleFontsUrl?: string };
  /** A sentence on when to use this brand, e.g. "his own LinkedIn posts and portfolio". */
  usedFor?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function brandsPath(home: string): string {
  return join(home, "brands.json");
}

export function readBrands(home: string): BrandProfile[] {
  try {
    const f = brandsPath(home);
    if (!existsSync(f)) return [];
    const v = JSON.parse(readFileSync(f, "utf8"));
    return Array.isArray(v) ? v.filter((b) => b && typeof b.id === "string" && typeof b.name === "string") : [];
  } catch {
    return [];
  }
}

function write(home: string, list: BrandProfile[]) {
  mkdirSync(home, { recursive: true });
  writeFileSync(brandsPath(home), JSON.stringify(list, null, 2));
}

export function saveBrand(home: string, profile: BrandProfile): BrandProfile {
  if (!ID.test(profile.id)) throw new Error("Brand id must be lowercase letters, digits and dashes, e.g. sfa or nexaforge.");
  for (const f of [profile.logo?.dark, profile.logo?.light]) {
    if (f && !existsSync(f)) throw new Error(`Logo file not found: ${f}`);
  }
  const list = readBrands(home).filter((b) => b.id !== profile.id);
  list.push(profile);
  write(home, list);
  return profile;
}

export function removeBrand(home: string, id: string): boolean {
  const list = readBrands(home);
  const keep = list.filter((b) => b.id !== id);
  if (keep.length === list.length) return false;
  write(home, keep);
  return true;
}

export function getBrand(home: string, id: string): BrandProfile | undefined {
  return readBrands(home).find((b) => b.id === id);
}

/** A registered profile filled in under whatever the caller passed explicitly; explicit values win. */
export function mergeBrand(profile: BrandProfile | undefined, given: Brand): Brand {
  if (!profile) return given;
  return {
    ...given,
    name: given.name ?? profile.name,
    publisher: given.publisher ?? profile.publisher,
    logo: given.logo ?? profile.logo,
    colors: given.colors?.length ? given.colors : profile.colors,
  };
}
