import { describe, expect, it } from "vitest";
import { CATALOGS, CATALOG_VERSIONS } from "../src/index.js";

// Mirrors scripts/lib.mjs's compareSemver. Not imported from there directly: scripts/*.mjs is
// untyped JS outside this package's tsconfig (types: ["node"], include: ["src", "test"]), so
// importing it would fail `tsc -p tsconfig.json` without a declaration file.
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/**
 * Catalog 1.1.0 adds `fillMode` as a sixth standard param (README, CHANGELOG.md). It must
 * change nothing else relative to 1.0.0: same ids, same keyframes, same other params (in the
 * same relative order), same triggers. This test strips `fillMode` back out of every 1.1.0
 * entry's params and asserts the result deep-equals 1.0.0 (modulo the `version` field).
 */
describe("catalog 1.1.0: fillMode is the only change from 1.0.0", () => {
  it("1.1.0 minus fillMode params deep-equals 1.0.0 minus version", () => {
    const v100 = CATALOGS["1.0.0"];
    const v110 = CATALOGS["1.1.0"];

    const stripped = {
      entries: v110.entries.map((entry) => ({
        ...entry,
        params: entry.params.filter((p) => p.key !== "fillMode"),
      })),
    };
    const expected = { entries: v100.entries };

    expect(stripped).toEqual(expected);
  });

  it("every 1.1.0 entry declares fillMode right after the last standard param", () => {
    const standard = new Set(["duration", "delay", "easing", "iteration", "direction"]);
    for (const entry of CATALOGS["1.1.0"].entries) {
      const keys = entry.params.map((p) => p.key);
      const fillModeIndex = keys.indexOf("fillMode");
      expect(fillModeIndex, `${entry.id} must declare fillMode`).toBeGreaterThanOrEqual(0);
      for (let i = 0; i < fillModeIndex; i++) expect(standard.has(keys[i])).toBe(true);
      for (let i = fillModeIndex + 1; i < keys.length; i++) expect(standard.has(keys[i])).toBe(false);
    }
  });

  it("fillMode defaults follow the category rule from CHANGELOG.md, with the documented emphasis exceptions", () => {
    const expectedByCategory: Record<string, string> = {
      entrance: "both",
      exit: "forwards",
      attention: "none",
      emphasis: "none",
      continuous: "none",
      hover: "forwards",
    };
    const emphasisOverrides: Record<string, string> = {
      highlight: "forwards",
      "underline-sweep": "forwards",
    };

    for (const entry of CATALOGS["1.1.0"].entries) {
      const fillMode = entry.params.find((p) => p.key === "fillMode");
      expect(fillMode, `${entry.id} must declare fillMode`).toBeDefined();
      const expected =
        entry.category === "emphasis" && Object.hasOwn(emphasisOverrides, entry.id)
          ? emphasisOverrides[entry.id]
          : expectedByCategory[entry.category];
      expect(fillMode?.default, entry.id).toBe(expected);
    }
  });

  it("no fillMode param carries a label (the other five standard keys don't either)", () => {
    for (const entry of CATALOGS["1.1.0"].entries) {
      const fillMode = entry.params.find((p) => p.key === "fillMode");
      expect(fillMode?.label, entry.id).toBeUndefined();
    }
  });

  it("every version from 1.1.0 onward (by semver, not just != 1.0.0) declares fillMode on every entry", () => {
    for (const version of CATALOG_VERSIONS) {
      const declaresAll = CATALOGS[version].entries.every((e) => e.params.some((p) => p.key === "fillMode"));
      expect(declaresAll, version).toBe(compareSemver(version, "1.1.0") >= 0);
    }
  });
});
