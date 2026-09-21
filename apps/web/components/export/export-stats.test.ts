import { describe, expect, it } from "vitest";

import type { Assignment, EditorStateMap, Trigger } from "@/lib/api-client";

import { exportCounts, formatExportStats } from "./export-stats";

function assignment(animationId: string, trigger: Trigger = "load", catalogVersion = "1.1.0"): Assignment {
  return { animationId, catalogVersion, trigger, params: {} };
}

function state(rows: Record<string, Assignment>): EditorStateMap {
  return rows;
}

describe("exportCounts", () => {
  it("counts distinct animations and the elements they are on", () => {
    expect(
      exportCounts(
        state({
          "vm-3": assignment("fade-in-up"),
          "vm-9": assignment("fade-in-up"),
          "vm-14": assignment("pulse", "hover"),
        }),
      ),
    ).toEqual({ animations: 2, elements: 3 });
  });

  it("counts one animation pinned to two catalog versions once", () => {
    expect(
      exportCounts(
        state({
          "vm-3": assignment("fade-in-up", "load", "1.0.0"),
          "vm-9": assignment("fade-in-up", "load", "1.1.0"),
        }),
      )?.animations,
    ).toBe(1);
  });

  it("is zeroes for a version with nothing animated", () => {
    expect(exportCounts({})).toEqual({ animations: 0, elements: 0 });
  });

  it("counts nothing at all when the caller has no state", () => {
    // Not `{ animations: 0, elements: 0 }`: "0 animations" under a non-empty
    // export is a lie, and a missing clause is not.
    expect(exportCounts(undefined)).toBeUndefined();
  });
});

describe("formatExportStats", () => {
  it("is the handoff's line", () => {
    expect(formatExportStats({ animations: 2, elements: 4 }, false)).toBe(
      "2 animations · 4 elements · js not needed (no in-view triggers)",
    );
  });

  it("says the script is in the zip when something needs it", () => {
    expect(formatExportStats({ animations: 3, elements: 3 }, true)).toBe(
      "3 animations · 3 elements · includes vibe-motion.js (in-view triggers)",
    );
  });

  it("counts one of something as one", () => {
    expect(formatExportStats({ animations: 1, elements: 1 }, false)).toBe(
      "1 animation · 1 element · js not needed (no in-view triggers)",
    );
  });

  it("survives an export of nothing", () => {
    expect(formatExportStats({ animations: 0, elements: 0 }, false)).toBe(
      "0 animations · 0 elements · js not needed (no in-view triggers)",
    );
  });

  it("says only what it knows when there are no counts", () => {
    expect(formatExportStats(undefined, true)).toBe(
      "includes vibe-motion.js (in-view triggers)",
    );
    expect(formatExportStats(undefined, false)).toBe("js not needed (no in-view triggers)");
  });
});
