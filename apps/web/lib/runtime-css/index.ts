/**
 * Runtime CSS generator.
 *
 * The single pure module that turns `(catalog entry, catalogVersion, params)`
 * into CSS. Consumed by the help page's live demos now; the preview bridge
 * (Phase 4) and the draft store reuse it to render the same animation the
 * editor and the export share, since CSS is derived from the catalog entry +
 * params and is never stored (CLAUDE.md rule 9).
 *
 * No React, no DOM, no network — safe to run on the server (help page) or in
 * the browser (bridge, draft store).
 */
import type { CatalogEntry, CatalogParam } from "animation-catalog";
import { keyframesName } from "animation-catalog";

/**
 * Catalog param keys that map to a standard `animation-*` longhand instead of
 * a `--vm-*` custom property. Mirrors `packages/animation-catalog/schema.json`
 * ("The five standard keys ... map to animation-* properties"), plus
 * `fillMode` (`animation-fill-mode`) for catalog versions that declare it —
 * any other key must carry `cssVar`.
 */
const STANDARD_PROPERTY_BY_KEY: Readonly<Record<string, string>> = {
  duration: "animation-duration",
  delay: "animation-delay",
  easing: "animation-timing-function",
  iteration: "animation-iteration-count",
  direction: "animation-direction",
  fillMode: "animation-fill-mode",
};

/**
 * Every catalog param key on `entry`, mapped to the value in `params` when
 * given, otherwise the catalog `default`. Keys in `params` that are not
 * declared on `entry` are dropped.
 */
export function resolveParams(
  entry: CatalogEntry,
  params?: Readonly<Record<string, string>>,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const param of entry.params as CatalogParam[]) {
    resolved[param.key] = params?.[param.key] ?? param.default;
  }
  return resolved;
}

/** `@keyframes <name> { <entry.keyframes> }`, where `<name>` is `keyframesName(entry.id, catalogVersion)`. */
export function keyframesCss(entry: CatalogEntry, catalogVersion: string): string {
  return `@keyframes ${keyframesName(entry.id, catalogVersion)} { ${entry.keyframes} }`;
}

/**
 * A flat CSS property -> value map for assigning `entry` (resolved against
 * `params`) to an element: `animation-name`, the standard `animation-*`
 * longhand for every standard-key param, and one `--vm-*` custom property for
 * every param that declares `cssVar`.
 *
 * Throws if a param has neither a standard mapping nor a `cssVar` — per the
 * catalog schema every param must be one or the other, so this is a catalog
 * bug, not something to skip silently.
 */
export function assignmentStyle(
  entry: CatalogEntry,
  catalogVersion: string,
  params?: Readonly<Record<string, string>>,
): Record<string, string> {
  const resolved = resolveParams(entry, params);
  const style: Record<string, string> = {
    "animation-name": keyframesName(entry.id, catalogVersion),
  };

  for (const param of entry.params as CatalogParam[]) {
    const value = resolved[param.key];
    const standardProperty = STANDARD_PROPERTY_BY_KEY[param.key];
    if (standardProperty) {
      style[standardProperty] = value;
    } else if (param.cssVar) {
      style[param.cssVar] = value;
    } else {
      throw new Error(
        `runtime-css: param "${param.key}" on animation "${entry.id}" has no standard ` +
          `animation-* mapping and no cssVar — every catalog param must declare one or the other.`,
      );
    }
  }

  return style;
}

/**
 * `assignmentStyle` in the shape React's `style` prop takes: standard
 * properties camel-cased (React rejects `animation-name` as a style key),
 * custom properties left exactly as they are (React sets `--vm-*` verbatim).
 *
 * The picker's card demos and the help page's live demos both render the
 * animation as an inline style rather than a stylesheet rule, so the
 * conversion lives here, next to the map it converts, rather than in each
 * component.
 */
export function inlineStyle(
  entry: CatalogEntry,
  catalogVersion: string,
  params?: Readonly<Record<string, string>>,
): Record<string, string> {
  const style: Record<string, string> = {};
  for (const [property, value] of Object.entries(assignmentStyle(entry, catalogVersion, params))) {
    const key = property.startsWith("--")
      ? property
      : property.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    style[key] = value;
  }
  return style;
}

/**
 * De-duplicated `@keyframes` CSS for a list of `(entry, catalogVersion)`
 * pairs: one block per distinct keyframes name, in first-seen order.
 */
export function runtimeStylesheet(
  pairs: ReadonlyArray<readonly [CatalogEntry, string]>,
): string {
  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const [entry, catalogVersion] of pairs) {
    const name = keyframesName(entry.id, catalogVersion);
    if (seen.has(name)) continue;
    seen.add(name);
    blocks.push(keyframesCss(entry, catalogVersion));
  }

  return blocks.join("\n\n");
}
