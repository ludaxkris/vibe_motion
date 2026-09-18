/**
 * Catalog param -> the control that edits it.
 *
 * The tuning panel renders from the catalog, never from a list of animations
 * it knows by name (CLAUDE.md: "Add a params entry rather than special-casing
 * an animation in code"), so the decision of *which* control a param gets is
 * this one pure function — and the handoff's rows (Duration, Delay, Distance,
 * Scale, Easing, Repeat) fall out of it rather than being hand-placed.
 *
 * Ruling in docs/plans/phase-3-web-shell.md, "Design handoff": slider ranges
 * come from the catalog's own min/max/step, and params the handoff does not
 * mock (`fillMode`, `direction`, any other `select`) take the dense segmented
 * at four options or fewer, else the easing-style select.
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
const EASING_OPTIONS = ["linear", "ease", "ease-in", "ease-out", "ease-in-out"];
const DIRECTION_OPTIONS = ["normal", "reverse", "alternate", "alternate-reverse"];

export type SegmentedOption = { value: string; label: string };

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

/** The option list, with the param's own default appended when it is missing from it. */
function withDefault(options: readonly string[], defaultValue: string): string[] {
  return options.includes(defaultValue) ? [...options] : [...options, defaultValue];
}

function optionsFor(param: CatalogParam, fallback: readonly string[]): string[] {
  return withDefault(param.options?.length ? param.options : fallback, param.default);
}

/** "infinite" reads as the handoff's ∞; every other CSS value speaks for itself. */
function segmentLabel(value: string): string {
  return value === "infinite" ? "∞" : value;
}

function toSegments(options: readonly string[]): SegmentedOption[] {
  return options.map((value) => ({ value, label: segmentLabel(value) }));
}

/** The numeric part of a catalog bound (`"200px"` -> 200), or `fallback` when unset. */
function bound(value: string | undefined, fallback: number): number {
  return value === undefined ? fallback : splitValue(value).amount;
}

/** Which control edits `param`, and everything that control needs to render. */
export function paramControl(param: CatalogParam): ParamControl {
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
    return { kind: "easing", options: optionsFor(param, EASING_OPTIONS) };
  }

  const options = optionsFor(
    param,
    param.type === "iteration"
      ? ITERATION_OPTIONS
      : param.type === "direction"
        ? DIRECTION_OPTIONS
        : [],
  );

  return options.length > MAX_SEGMENTS
    ? { kind: "select", options }
    : { kind: "segmented", options: toSegments(options) };
}
