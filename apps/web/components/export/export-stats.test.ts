import { describe, expect, it } from "vitest";

import type { Assignment, EditorStateMap, Trigger } from "@/lib/api-client";

import { exportStats, formatExportStats } from "./export-stats";

function assignment(animationId: string, trigger: Trigger = "load", catalogVersion = "1.1.0"): Assignment {
  return { animationId, catalogVersion, trigger, params: {} };
}

function state(rows: Record<string, Assignment>): EditorStateMap {
  return rows;
}

describe("exportStats", () => {
  it("counts distinct animations and the elements they are on", () => {
    expect(
      exportStats(
        state({
          "vm-3": assignment("fade-in-up"),
          "vm-9": assignment("fade-in-up"),
          "vm-14": assignment("pulse", "hover"),
        }),
      ),
    ).toEqual({ animations: 2, elements: 3, needsJs: false });
  });

  it("counts one animation pinned to two catalog versions once", () => {
    expect(
      exportStats(
        state({
          "vm-3": assignment("fade-in-up", "load", "1.0.0"),
          "vm-9": assignment("fade-in-up", "load", "1.1.0"),
        }),
      ).animations,
    ).toBe(1);
  });

  it("needs the script exactly when something uses in-view", () => {
    expect(exportStats(state({ "vm-3": assignment("fade-in-up", "in-view") })).needsJs).toBe(true);
    expect(exportStats(state({ "vm-3": assignment("pulse", "hover") })).needsJs).toBe(false);
  });

  it("is zeroes for a version with nothing animated, and for no state at all", () => {
    const empty = { animations: 0, elements: 0, needsJs: false };
    expect(exportStats({})).toEqual(empty);
    expect(exportStats(undefined)).toEqual(empty);
  });
});

describe("formatExportStats", () => {
  it("is the handoff's line", () => {
    expect(formatExportStats({ animations: 2, elements: 4, needsJs: false })).toBe(
      "2 animations · 4 elements · js not needed (no in-view triggers)",
    );
  });

  it("says the script is in the zip when something needs it", () => {
    expect(formatExportStats({ animations: 3, elements: 3, needsJs: true })).toBe(
      "3 animations · 3 elements · includes vibe-motion.js (in-view triggers)",
    );
  });

  it("counts one of something as one", () => {
    expect(formatExportStats({ animations: 1, elements: 1, needsJs: false })).toBe(
      "1 animation · 1 element · js not needed (no in-view triggers)",
    );
  });

  it("survives an export of nothing", () => {
    expect(formatExportStats({ animations: 0, elements: 0, needsJs: false })).toBe(
      "0 animations · 0 elements · js not needed (no in-view triggers)",
    );
  });
});
