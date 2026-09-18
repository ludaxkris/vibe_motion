import { describe, expect, it } from "vitest";
import { CATALOGS, CATALOG_VERSIONS } from "../src/index.js";

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
      hover: "both",
    };
    const emphasisOverrides: Record<string, string> = {
      highlight: "forwards",
      "underline-sweep": "forwards",
    };

    for (const entry of CATALOGS["1.1.0"].entries) {
      const fillMode = entry.params.find((p) => p.key === "fillMode");
      expect(fillMode, `${entry.id} must declare fillMode`).toBeDefined();
      const expected =
        entry.category === "emphasis" && entry.id in emphasisOverrides
          ? emphasisOverrides[entry.id]
          : expectedByCategory[entry.category];
      expect(fillMode?.default, entry.id).toBe(expected);
    }
  });

  it("only 1.0.0 is exempt from declaring fillMode", () => {
    for (const version of CATALOG_VERSIONS) {
      const declaresAll = CATALOGS[version].entries.every((e) => e.params.some((p) => p.key === "fillMode"));
      expect(declaresAll, version).toBe(version !== "1.0.0");
    }
  });
});
