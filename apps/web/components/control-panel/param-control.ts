/**
 * Catalog param -> the control that edits it.
 *
 * The tuning panel renders from the catalog, never from a list of animations
 * it knows by name (CLAUDE.md: "Add a params entry rather than special-casing
 * an animation in code"), so the decision of *which* control a param gets is
 * this one pure function — and the handoff's rows (Duration, Delay, Distance,
 * Scale, Easing, Repeat) fall out of it rather than being hand-placed.
 *
 * Ruling in docs/plans/phase-3-web-shell.md, "Design handoff", as amended by
 * the screenshot pass: slider ranges come from the catalog's own min/max/step,
 * and params the handoff does not mock (`fillMode`, `direction`, any other
 * `select`) take the dense segmented only when there are at most four options
 * *and* every label is short enough to be read whole in a quarter of a 320px
 * panel. Anything else takes the easing-style select row, where a long CSS
 * keyword has the width to say which one it is.
 */
import type { CatalogParam } from "@/lib/api-client";

import { splitValue } from "./param-value";

/** Param types that read as an amount, and so get a slider + number field. */
const SLIDER_TYPES: ReadonlySet<CatalogParam["type"]> = new Set([
  "duration",
  "length",
  "number",
  "angle",
  "percentage",
]);

/** Above this many options a segmented row stops fitting the 320px panel. */
const MAX_SEGMENTS = 4;

/**
 * …and above this many characters one segment's label clips instead of
 * reading: four segments share ~198px, so "backwards" lands as "backwa…" and
 * "alternate" and "alternate-reverse" become the same word twice.
 */
const MAX_SEGMENT_LABEL = 8;

/**
 * Display names for the standard param keys, which the catalog leaves
 * unlabelled (they are CSS-level, not animation-level). The words are the
 * handoff's — `iteration` is "Repeat" on screen.
 */
const STANDARD_LABELS: Readonly<Record<string, string>> = {
  duration: "Duration",
  delay: "Delay",
  easing: "Easing",
  iteration: "Repeat",
  fillMode: "Fill mode",
  direction: "Direction",
};

// The catalog does not always declare `options` for these types (schema.json:
// "options" is required only to be meaningful for `select`, and is "the
// suggested list" for `easing`) — fall back to a standard CSS list. The
// iteration list is the handoff's Repeat row.
const ITERATION_OPTIONS = ["1", "2", "3", "infinite"];
// The handoff's order (docs/design/README.md, "tuning"): most-reached-for
// first, not alphabetical.
const EASING_OPTIONS = ["ease", "ease-out", "ease-in", "ease-in-out", "linear"];
const DIRECTION_OPTIONS = ["normal", "reverse", "alternate", "alternate-reverse"];

export type SegmentedOption = {
  value: string;
  label: string;
  /** Set when the label is a glyph the label alone does not say out loud. */
  ariaLabel?: string;
};

export type ParamControl =
  | { kind: "slider"; min: number; max: number; step: number; unit: string }
  | { kind: "easing"; options: readonly string[] }
  | { kind: "segmented"; options: readonly SegmentedOption[] }
  | { kind: "select"; options: readonly string[] }
  | { kind: "color" };

/** The catalog's label, the handoff's word for a standard key, or the key itself. */
export function paramLabel(param: CatalogParam): string {
  return param.label ?? STANDARD_LABELS[param.key] ?? param.key;
}

/** The option list, with `candidate` appended when it is missing from it. */
function including(options: readonly string[], candidate: string | undefined): string[] {
  return candidate === undefined || options.includes(candidate)
    ? [...options]
    : [...options, candidate];
}

/**
 * The catalog's options (or the standard CSS fallback), always holding both
 * the param's default *and* the value being edited: a control that cannot
 * show the value it is bound to silently disagrees with the draft — a saved
 * `iteration: "5"` would render with nothing selected.
 */
function optionsFor(
  param: CatalogParam,
  fallback: readonly string[],
  value: string | undefined,
): string[] {
  const declared = param.options?.length ? param.options : fallback;
  return including(including(declared, param.default), value);
}

function toSegment(value: string): SegmentedOption {
  // "infinite" reads as the handoff's ∞, which is a picture — so it carries
  // the word for anyone who cannot see it. Every other CSS value speaks for
  // itself.
  return value === "infinite"
    ? { value, label: "∞", ariaLabel: "Infinite" }
    : { value, label: value };
}

/** The numeric part of a catalog bound (`"200px"` -> 200), or `fallback` when unset. */
function bound(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : splitValue(value).amount;
}

/**
 * Which control edits `param`, and everything that control needs to render.
 *
 * `value` is the value the control will be bound to, when there is one: an
 * option list has to contain it (see {@link optionsFor}).
 */
export function paramControl(param: CatalogParam, value?: string): ParamControl {
  if (SLIDER_TYPES.has(param.type)) {
    return {
      kind: "slider",
      min: bound(param.min, 0),
      max: bound(param.max, 100),
      step: bound(param.step, 1),
      // The unit is the default value's own suffix; a bare `number` is a
      // multiplier in this catalog (scale, fromScale, toScale) and carries
      // the handoff's "×".
      unit: splitValue(param.default).unit || (param.type === "number" ? "×" : ""),
    };
  }

  if (param.type === "color") return { kind: "color" };

  // Easing keeps its own kind: it is the one select the handoff pairs with a
  // curve preview, whatever the option count.
  if (param.type === "easing") {
    return { kind: "easing", options: optionsFor(param, EASING_OPTIONS, value) };
  }

  const options = optionsFor(
    param,
    param.type === "iteration"
      ? ITERATION_OPTIONS
      : param.type === "direction"
        ? DIRECTION_OPTIONS
        : [],
    value,
  );

  const segments = options.map(toSegment);
  const fitsInline =
    options.length <= MAX_SEGMENTS &&
    segments.every((segment) => segment.label.length <= MAX_SEGMENT_LABEL);

  return fitsInline ? { kind: "segmented", options: segments } : { kind: "select", options };
}
