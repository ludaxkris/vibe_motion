import type { ElementInfo } from "bridge";

import type { SkipReason, Viewport } from "./types";

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

/**
 * Sub-pixel layout: a child's edge may round to just outside its parent's.
 *
 * 1.5 px, not the half pixel sub-pixel layout alone needs, because two rects in
 * one comparison can come from two different measurements. The bridge reports
 * an element's **resting** box, which is `getBoundingClientRect()` (fractional)
 * while nothing of ours is applied to it or an ancestor, and the integer-snapped
 * layout box once something is — so a container and its child can straddle that
 * boundary, either way round: a hand-animated card with untouched children, or
 * the remembered container `run.ts` still substitutes on a regenerate (DT-150)
 * against children measured fresh. Measured worst case 0.75 px per edge over
 * `offsetParent` hops (DT-198); at 0.5 px about 5% of truly nested pairs were
 * lost, at 1 px none. 1.5 px keeps a margin and costs nothing: a child that
 * overflows its block by a pixel is still part of the block, and 14,160 pairs
 * produced no false nesting at this tolerance.
 */
const NESTED_TOLERANCE_PX = 1.5;

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

/** An entrance element taller than one screen cannot animate as one unit. */
function tooLarge(el: ElementInfo, viewport: Viewport | undefined): boolean {
  return !isHoverTarget(el) && viewport !== undefined && el.pageRect.height > viewport.height;
}

type Entry = {
  el: ElementInfo;
  /** Position in the combined document order; breaks the tie between identical boxes. */
  index: number;
  reason: SkipReason | null;
  /** False for a block: it shapes the nesting and is never reported. */
  assignable: boolean;
};

/**
 * The agent-side re-check of the bridge filter. Targets come back in document
 * order whatever the input order (elements the bridge could not place, `order`
 * below 0, go last).
 *
 * A block animates as one unit: an entrance target whose `pageRect` lies fully
 * inside a container's (`CONTAINER_TAGS`) is skipped as `"nested"`.
 * `ElementInfo` has no parent pointer, so this is geometry: all four edges
 * within the container's (0.5 px tolerance), and the container strictly
 * larger, or the same size and earlier in document order, so two identical
 * boxes never eliminate each other. A container inside a container is nested
 * too, which leaves the outermost. Hover targets are never nested: a link
 * inside an animated card keeps its hover. O(targets × containers).
 *
 * `opts.blocks` are elements the agent may NOT assign but that already animate
 * as a block (a card the designer animated by hand): they count as containers
 * on the same terms as a target would, and never appear in `targets` or
 * `skipped`. Nesting is decided against everything listed, not only against
 * what is up for assignment.
 *
 * With `opts.viewport`, an entrance element taller than the viewport is
 * `"too-large"`: it is neither a target nor a container, so what is inside it
 * is judged on its own. An `in-view` entrance on something several screens
 * tall may never reach the bridge's visibility threshold, and its held first
 * keyframe would hide the page. Without a viewport the rule is off.
 */
export function selectTargets(
  elements: readonly ElementInfo[],
  opts: { blocks?: readonly ElementInfo[]; viewport?: Viewport } = {},
): {
  targets: ElementInfo[];
  skipped: { vmId: string; reason: SkipReason }[];
} {
  const assignable = new Set(elements.map((el) => el.vmId));
  // An element listed both ways is judged as an element.
  const blocks = (opts.blocks ?? []).filter((el) => !assignable.has(el.vmId));
  const entries: Entry[] = [...elements, ...blocks].sort(byDocumentOrder).map((el, index) => ({
    el,
    index,
    reason: skipReason(el) ?? (tooLarge(el, opts.viewport) ? "too-large" : null),
    assignable: assignable.has(el.vmId),
  }));

  const containers = entries.filter(
    ({ el, reason }) => reason === null && CONTAINER_TAGS.includes(el.tag) && !isHoverTarget(el),
  );

  const targets: ElementInfo[] = [];
  const skipped: { vmId: string; reason: SkipReason }[] = [];
  for (const entry of entries) {
    if (!entry.assignable) continue;
    const { el } = entry;
    let { reason } = entry;
    if (reason === null && !isHoverTarget(el)) {
      const size = area(el.pageRect);
      const nested = containers.some((container) => {
        if (container === entry) return false;
        const containerSize = area(container.el.pageRect);
        if (containerSize < size || (containerSize === size && container.index > entry.index)) return false;
        return contains(container.el.pageRect, el.pageRect);
      });
      if (nested) reason = "nested";
    }
    if (reason) skipped.push({ vmId: el.vmId, reason });
    else targets.push(el);
  }
  return { targets, skipped };
}
