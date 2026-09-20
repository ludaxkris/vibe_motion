import type { ElementInfo } from "bridge";

import type { SkipReason } from "./types";

/**
 * The border box an element needs to be worth animating, in px. The floor is
 * not square: one line of text must pass (a browser-default `h1` is ~37 px
 * tall, an `h2` ~28 px, a one-line `p` ~18 px, and those are what
 * Auto-generate exists for), while icons, hairlines and 1-px spacers must not.
 */
export const MIN_TARGET_WIDTH = 40;
export const MIN_TARGET_HEIGHT = 16;

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
  if (el.pageRect.width < MIN_TARGET_WIDTH || el.pageRect.height < MIN_TARGET_HEIGHT) {
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
 * Tags that make a block: the block animates as one unit, so an entrance
 * target that sits inside one is left alone. Animating a card AND its heading
 * AND its paragraph is three entrances for one thing, and the card's
 * `fillMode: both` holds `opacity: 0` over its children's entrances (DT-133).
 */
export const CONTAINER_TAGS: readonly string[] = ["article", "figure", "li", "blockquote"];

/** Sub-pixel layout: a child's edge may round to just outside its parent's. */
const NESTED_TOLERANCE_PX = 0.5;

type Rect = ElementInfo["pageRect"];

function area(rect: Rect): number {
  return rect.width * rect.height;
}

function contains(outer: Rect, inner: Rect): boolean {
  const t = NESTED_TOLERANCE_PX;
  return (
    inner.x >= outer.x - t &&
    inner.y >= outer.y - t &&
    inner.x + inner.width <= outer.x + outer.width + t &&
    inner.y + inner.height <= outer.y + outer.height + t
  );
}

/**
 * The agent-side re-check of the bridge filter. Targets come back in document
 * order whatever the input order (elements the bridge could not place, `order`
 * below 0, go last).
 *
 * A block animates as one unit: an entrance target whose `pageRect` lies fully
 * inside a container target's (`CONTAINER_TAGS`) is skipped as `"nested"`.
 * `ElementInfo` has no parent pointer, so this is geometry: all four edges
 * within the container's (0.5 px tolerance), and the container strictly
 * larger, or the same size and earlier in document order, so two identical
 * boxes never eliminate each other. A container inside a container is nested
 * too, which leaves the outermost. Hover targets are never nested: a link
 * inside an animated card keeps its hover. O(targets × containers).
 */
export function selectTargets(elements: readonly ElementInfo[]): {
  targets: ElementInfo[];
  skipped: { vmId: string; reason: SkipReason }[];
} {
  const sorted = [...elements].sort(byDocumentOrder);
  const reasons: (SkipReason | null)[] = sorted.map(skipReason);

  const containers: number[] = [];
  sorted.forEach((el, index) => {
    if (reasons[index] === null && CONTAINER_TAGS.includes(el.tag) && !isHoverTarget(el)) {
      containers.push(index);
    }
  });

  const targets: ElementInfo[] = [];
  const skipped: { vmId: string; reason: SkipReason }[] = [];
  sorted.forEach((el, index) => {
    let reason = reasons[index] ?? null;
    if (reason === null && !isHoverTarget(el)) {
      const size = area(el.pageRect);
      const nested = containers.some((at) => {
        const container = sorted[at];
        if (at === index || !container || container.vmId === el.vmId) return false;
        const containerSize = area(container.pageRect);
        if (containerSize < size || (containerSize === size && at > index)) return false;
        return contains(container.pageRect, el.pageRect);
      });
      if (nested) reason = "nested";
    }
    if (reason) skipped.push({ vmId: el.vmId, reason });
    else targets.push(el);
  });
  return { targets, skipped };
}
