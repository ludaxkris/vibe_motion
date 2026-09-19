import { readFileSync } from "node:fs";
import path from "node:path";

import { keyframesName } from "animation-catalog";
import { describe, expect, it } from "vitest";

import {
  CURRENT_CATALOG_VERSION,
  catalogInlineStyle,
  catalogKeyframes,
  defaultAssignmentFor,
  getCatalogEntries,
  getCatalogEntry,
  getCatalogEntryAt,
  resolveCatalogParams,
} from "@/lib/catalog";

describe("catalog", () => {
  it("authors against the version in packages/animation-catalog/current", () => {
    // Reads the real pointer file so bumping `current` without updating lib/catalog.ts fails here.
    const current = readFileSync(
      path.resolve(__dirname, "../../../packages/animation-catalog/current"),
      "utf8",
    ).trim();
    expect(CURRENT_CATALOG_VERSION).toBe(current);
  });

  it("loads all 26 entries of catalog 1.1.0", () => {
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

describe("getCatalogEntryAt", () => {
  it("resolves against the version asked for, not the current one", () => {
    // 1.1.0 added `fillMode` to every entry, so an assignment still pinned to
    // 1.0.0 must not grow a row the version it was saved against never had.
    const pinned = getCatalogEntryAt("1.0.0", "fade-in");
    expect(pinned?.params.map((p) => p.key)).toEqual(["duration", "delay", "easing"]);

    const current = getCatalogEntryAt(CURRENT_CATALOG_VERSION, "fade-in");
    expect(current?.params.map((p) => p.key)).toContain("fillMode");
  });

  it("agrees with getCatalogEntry for the current version", () => {
    expect(getCatalogEntryAt(CURRENT_CATALOG_VERSION, "pulse")).toEqual(getCatalogEntry("pulse"));
  });

  it("is undefined for an unknown version or an unknown id", () => {
    expect(getCatalogEntryAt("9.9.9", "fade-in")).toBeUndefined();
    expect(getCatalogEntryAt(CURRENT_CATALOG_VERSION, "no-such-animation")).toBeUndefined();
  });
});

describe("catalog type bridges", () => {
  it("catalogInlineStyle renders an entry's animation as a React style object", () => {
    const entry = getCatalogEntry("fade-in-up")!;
    const style = catalogInlineStyle(entry, CURRENT_CATALOG_VERSION);

    expect(style.animationName).toBe(keyframesName(entry.id, CURRENT_CATALOG_VERSION));
    expect(style.animationDuration).toBe("600ms");
  });

  it("catalogKeyframes emits one block per entry", () => {
    const entries = [getCatalogEntry("fade-in")!, getCatalogEntry("pulse")!];
    const css = catalogKeyframes(entries.map((entry) => [entry, CURRENT_CATALOG_VERSION] as const));

    for (const entry of entries) {
      expect(css).toContain(`@keyframes ${keyframesName(entry.id, CURRENT_CATALOG_VERSION)}`);
    }
  });
});

describe("defaultAssignmentFor", () => {
  it("pins the current catalog version and takes the entry's own defaults", () => {
    const entry = getCatalogEntry("fade-in-up")!;

    expect(defaultAssignmentFor(entry)).toEqual({
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger ?? entry.triggers[0],
      params: resolveCatalogParams(entry),
    });
  });

  it("falls back to the entry's first trigger when it declares no default", () => {
    const entry = getCatalogEntry("hover-lift")!;

    expect(defaultAssignmentFor({ ...entry, defaultTrigger: undefined }).trigger).toBe(
      entry.triggers[0],
    );
  });
});
