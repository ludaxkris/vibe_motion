import { describe, expect, it } from "vitest";

import { formatExportStats } from "./export-stats";

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
