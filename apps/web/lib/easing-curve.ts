/**
 * Easing value -> drawable cubic curve.
 *
 * The tuning panel's Easing row sits next to a 62px box that shows the curve
 * the selected easing describes (`docs/design/README.md` "2. Editor",
 * tuning). CSS gives the easing as either a keyword or a `cubic-bezier()`, so
 * this is the one place that turns both into the four control-point numbers —
 * and then into an SVG path. Pure: no DOM, no React.
 */

/** `[x1, y1, x2, y2]` of a `cubic-bezier()`; the end points are always (0,0) and (1,1). */
export type BezierPoints = readonly [number, number, number, number];

/**
 * The CSS keywords, with the curves the spec defines for them
 * (https://drafts.csswg.org/css-easing-1/#typedef-easing-function).
 */
const KEYWORD_CURVES: Readonly<Record<string, BezierPoints>> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

const CUBIC_BEZIER = /^cubic-bezier\(([^)]*)\)$/i;

/**
 * The four control points `value` describes, or `null` when it describes no
 * curve this can draw (`steps()`, `linear()` with stops, a malformed value).
 * A `null` is not an error — the caller draws a straight line instead.
 */
export function parseEasing(value: string): BezierPoints | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const keyword = KEYWORD_CURVES[trimmed];
  if (keyword) return keyword;

  const match = CUBIC_BEZIER.exec(trimmed);
  if (!match) return null;

  const numbers = match[1].split(",").map((part) => Number(part.trim()));
  if (numbers.length !== 4 || numbers.some((n) => !Number.isFinite(n))) return null;

  return [numbers[0], numbers[1], numbers[2], numbers[3]];
}

/** Trims float noise (0.42 * 40 = 16.799999999999997) without padding whole numbers. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * An SVG path for `value` inside a `width` x `height` box: progress runs left
 * to right, output runs bottom (0) to top (1). Control points outside [0, 1]
 * — the overshoot that makes a spring a spring — are drawn where they fall,
 * so the box has to let them overflow rather than clip them.
 */
export function easingCurvePath(value: string, width: number, height: number): string {
  const start = `M 0 ${round(height)}`;
  const end = `${round(width)} 0`;

  const points = parseEasing(value);
  if (!points) return `${start} L ${end}`;

  const [x1, y1, x2, y2] = points;
  const c1 = `${round(x1 * width)} ${round((1 - y1) * height)}`;
  const c2 = `${round(x2 * width)} ${round((1 - y2) * height)}`;
  return `${start} C ${c1} ${c2} ${end}`;
}
