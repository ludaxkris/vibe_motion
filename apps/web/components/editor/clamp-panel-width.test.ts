import { describe, expect, it } from "vitest";

import {
  clampPanelWidth,
  MAX_PANEL_WIDTH_PERCENT,
  MIN_PANEL_WIDTH_PERCENT,
} from "./clamp-panel-width";

describe("clampPanelWidth", () => {
  it("passes through a value already inside [20, 30]", () => {
    expect(clampPanelWidth(25)).toBe(25);
    expect(clampPanelWidth(20)).toBe(20);
    expect(clampPanelWidth(30)).toBe(30);
  });

  it("clamps values below the minimum up to 20", () => {
    expect(clampPanelWidth(0)).toBe(MIN_PANEL_WIDTH_PERCENT);
    expect(clampPanelWidth(-5)).toBe(MIN_PANEL_WIDTH_PERCENT);
    expect(clampPanelWidth(19.9)).toBe(MIN_PANEL_WIDTH_PERCENT);
  });

  it("clamps values above the maximum down to 30", () => {
    expect(clampPanelWidth(30.1)).toBe(MAX_PANEL_WIDTH_PERCENT);
    expect(clampPanelWidth(100)).toBe(MAX_PANEL_WIDTH_PERCENT);
  });
});
