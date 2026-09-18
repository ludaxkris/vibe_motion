import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CURRENT_CATALOG_VERSION,
  getCatalog,
  getCatalogEntries,
  getCatalogEntry,
} from "@/lib/catalog";

describe("catalog", () => {
  it("authors against the version in packages/animation-catalog/current", () => {
    // Reads the real pointer file so bumping `current` without updating lib/catalog.ts fails here.
    const current = readFileSync(
      path.resolve(__dirname, "../../../packages/animation-catalog/current"),
      "utf8",
    ).trim();
    expect(CURRENT_CATALOG_VERSION).toBe(current);
    expect(getCatalog().version).toBe(CURRENT_CATALOG_VERSION);
  });

  it("loads all 26 entries of catalog 1.0.0", () => {
    expect(getCatalogEntries()).toHaveLength(26);
  });

  it("gives every entry the fields the help page and control panel need", () => {
    for (const entry of getCatalogEntries()) {
      expect(entry.id).toMatch(/^[a-z0-9-]+$/);
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.category).toBeTypeOf("string");
      expect(entry.triggers.length).toBeGreaterThan(0);
    }
  });

  it("has unique entry ids and looks them up", () => {
    const ids = getCatalogEntries().map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getCatalogEntry(ids[0])?.id).toBe(ids[0]);
    expect(getCatalogEntry("no-such-animation")).toBeUndefined();
  });
});
