/**
 * Pure width math for `SplitPane`'s Control Panel handle.
 *
 * Kept separate from `split-pane.tsx` so the clamping rule has its own
 * fast, DOM-free unit tests (jsdom has no real layout to drag against).
 */
export const MIN_PANEL_WIDTH_PERCENT = 20;
export const MAX_PANEL_WIDTH_PERCENT = 30;
export const DEFAULT_PANEL_WIDTH_PERCENT = 25;

/** Clamps a candidate Control Panel width (percent of the container) into [20, 30]. */
export function clampPanelWidth(pct: number): number {
  return Math.min(MAX_PANEL_WIDTH_PERCENT, Math.max(MIN_PANEL_WIDTH_PERCENT, pct));
}
