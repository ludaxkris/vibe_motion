import type { ElementInfo } from "bridge";

import type { SkipReason } from "./types";

/** Border-box width and height an element needs to be worth animating, in px. */
export const MIN_TARGET_SIZE = 40;

/**
 * Lower-case tag names the agent animates. Also the `filter.tags` the shell
 * sends with `elements:query`; an element with `role="button"` matches too.
 * No `picture`: it is an inline box, so a transform on it does nothing, and
 * its `img` is a target already.
 */
export const TARGET_TAGS: readonly string[] = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote",
  "img", "video", "figure", "article", "button", "a",
];

const HOVER_TAGS: readonly string[] = ["button", "a"];

/** Interactive elements get a `hover` animation; everything else an entrance. */
export function isHoverTarget(el: ElementInfo): boolean {
  return HOVER_TAGS.includes(el.tag) || el.role === "button";
}

/** Why the agent leaves `el` alone, or null when it is a target. */
export function skipReason(el: ElementInfo): SkipReason | null {
  if (!el.visible) return "hidden";
  if (!TARGET_TAGS.includes(el.tag) && el.role !== "button") return "not-semantic";
  if (el.pageRect.width < MIN_TARGET_SIZE || el.pageRect.height < MIN_TARGET_SIZE) {
    return "too-small";
  }
  return null;
}

/** Total order: document order, the bridge's `order: -1` sentinel last, ties in input order. */
function byDocumentOrder(a: ElementInfo, b: ElementInfo): number {
  if (a.order < 0 || b.order < 0) return Number(a.order < 0) - Number(b.order < 0);
  return a.order - b.order;
}

/**
 * The agent-side re-check of the bridge filter. Targets come back in document
 * order whatever the input order (elements the bridge could not place, `order`
 * below 0, go last); nested targets are all kept.
 */
export function selectTargets(elements: readonly ElementInfo[]): {
  targets: ElementInfo[];
  skipped: { vmId: string; reason: SkipReason }[];
} {
  const targets: ElementInfo[] = [];
  const skipped: { vmId: string; reason: SkipReason }[] = [];
  for (const el of [...elements].sort(byDocumentOrder)) {
    const reason = skipReason(el);
    if (reason) skipped.push({ vmId: el.vmId, reason });
    else targets.push(el);
  }
  return { targets, skipped };
}
