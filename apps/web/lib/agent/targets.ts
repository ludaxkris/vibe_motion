import type { ElementInfo } from "bridge";

import type { SkipReason } from "./types";

/** Border-box width and height an element needs to be worth animating, in px. */
export const MIN_TARGET_SIZE = 40;

/**
 * Lower-case tag names the agent animates. Also the `filter.tags` the shell
 * sends with `elements:query`; an element with `role="button"` matches too.
 */
export const TARGET_TAGS: readonly string[] = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote",
  "img", "picture", "video", "figure", "article", "button", "a",
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

/**
 * The agent-side re-check of the bridge filter. Targets come back in document
 * order whatever the input order; nested targets are all kept.
 */
export function selectTargets(elements: readonly ElementInfo[]): {
  targets: ElementInfo[];
  skipped: { vmId: string; reason: SkipReason }[];
} {
  const targets: ElementInfo[] = [];
  const skipped: { vmId: string; reason: SkipReason }[] = [];
  for (const el of [...elements].sort((a, b) => a.order - b.order)) {
    const reason = skipReason(el);
    if (reason) skipped.push({ vmId: el.vmId, reason });
    else targets.push(el);
  }
  return { targets, skipped };
}
