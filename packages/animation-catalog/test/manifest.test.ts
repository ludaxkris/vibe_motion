import { describe, expect, it } from "vitest";
import { CATALOGS, CATALOG_VERSIONS, CURRENT_VERSION, keyframesName } from "../src/index.js";
import manifest from "../manifest.json" with { type: "json" };

/**
 * `manifest.json` is the cross-language source of truth for the set of
 * (version, animationId) pairs (see CLAUDE.md exit criterion for Phase 1: "Kotlin and
 * TS both load all versions and agree on the set of (version, animationId) pairs").
 * This test proves the TS side (CATALOGS / CURRENT_VERSION, as loaded by every TS
 * consumer) agrees with the committed manifest exactly. The Kotlin equivalent lives in
 * apps/api/src/test/kotlin/dev/vibemotion/api/catalog/CatalogRepositoryTest.kt.
 */
describe("manifest.json agrees with CATALOGS", () => {
  it("lists the same versions, in the same (ascending semver) order", () => {
    expect(Object.keys(manifest.versions)).toEqual([...CATALOG_VERSIONS]);
  });

  it("current matches CURRENT_VERSION", () => {
    expect(manifest.current).toBe(CURRENT_VERSION);
  });

  for (const version of CATALOG_VERSIONS) {
    it(`${version}: animation ids match, in file order`, () => {
      const ids = CATALOGS[version].entries.map((e) => e.id);
      expect(manifest.versions[version]).toEqual(ids);
    });

    it(`${version}: keyframesName() matches manifest.keyframesNames for every id`, () => {
      for (const entry of CATALOGS[version].entries) {
        expect(keyframesName(entry.id, version)).toBe(
          (manifest.keyframesNames as Record<string, Record<string, string>>)[version][entry.id],
        );
      }
    });
  }
});
