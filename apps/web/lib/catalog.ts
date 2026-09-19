/**
 * Build-time access to the animation catalog, bridged onto the OpenAPI types.
 *
 * Everything comes from the `animation-catalog` package, so this module, the
 * runtime CSS generator and the bridge all agree on the same immutable
 * versions. What this file adds is the type bridge: the package types entries
 * against `schema.json` while `apps/web` types them against the generated
 * OpenAPI schema, and this is the one place the two are reconciled.
 *
 * Two lookups, and the difference matters: `getCurrentCatalog` /
 * `getCatalogEntries` / `getCatalogEntry` are the catalog the editor *authors*
 * against, and `getCatalogEntryAt` resolves an existing assignment against the
 * version it pinned (CLAUDE.md rule 9). Phase 4+ swaps the source for
 * `GET /catalog` where a live catalog is needed; the pinning rule is unchanged
 * by that.
 */
import {
  CURRENT_VERSION,
  getCatalog as getCatalogByVersion,
  getEntry as getEntryByVersion,
  type CatalogEntry as CatalogPackageEntry,
} from "animation-catalog";

import type { Catalog, CatalogEntry } from "@/lib/api-client";
import { inlineStyle, resolveParams, runtimeStylesheet } from "@/lib/runtime-css";

/**
 * Mirrors `packages/animation-catalog/current`. The editor authors against this
 * version; every saved assignment pins the version it was authored with.
 */
export const CURRENT_CATALOG_VERSION: string = CURRENT_VERSION;

const catalog = getCatalogByVersion(CURRENT_VERSION) as unknown as Catalog;

/**
 * The catalog the editor currently authors against. Named for the version it
 * returns, so it does not read as the package's own `getCatalog(version)`.
 */
export function getCurrentCatalog(): Catalog {
  return catalog;
}

/** Every entry in the current catalog, in file order. */
export function getCatalogEntries(): readonly CatalogEntry[] {
  return catalog.entries;
}

/**
 * One entry by id, or `undefined` when the id is not in the current catalog.
 *
 * For the picker and anything else that *authors* new work. Anything rendering
 * an existing assignment wants {@link getCatalogEntryAt} against the version
 * that assignment pinned.
 */
export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.id === id);
}

/**
 * One entry by id, resolved against `catalogVersion` rather than the current
 * catalog.
 *
 * Every assignment pins the catalog version it was authored with (CLAUDE.md
 * rule 9), and versions differ: 1.1.0 gave every entry a `fillMode` param that
 * 1.0.0 has none of. Rendering a 1.0.0 assignment's rows out of 1.1.0 would
 * show a control for a param that animation never had — and would write a
 * value the pinned version cannot validate. So the tuning panel, the unsaved
 * guard and the idle list all resolve here, and only the picker (which is
 * choosing something new) reads the current catalog.
 */
export function getCatalogEntryAt(
  catalogVersion: string,
  id: string,
): CatalogEntry | undefined {
  return getEntryByVersion(catalogVersion, id) as CatalogEntry | undefined;
}

/**
 * The chip that is not a category: everything. Both chip rows — the editor's
 * picker and the help page — lead with it.
 */
export const ALL_CATEGORIES = "all";

/** A catalog category as it is written on screen ("entrance" -> "Entrance"). */
export function categoryLabel(category: string): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/**
 * The categories in `entries`, in catalog order, deduplicated: a chip row
 * follows the catalog rather than a list of categories hard-coded in the web
 * app, so a new category in a new catalog version shows up on its own.
 */
export function catalogCategories(entries: readonly CatalogEntry[]): string[] {
  return [...new Set(entries.map((entry) => entry.category))];
}

/**
 * `resolveParams` (Task 1, `lib/runtime-css`) types against the
 * `animation-catalog` package's own `CatalogEntry` (`triggers` is a
 * non-empty tuple, since the catalog schema requires `minItems: 1`), while
 * this module types entries against the OpenAPI-generated `CatalogEntry`
 * (a plain `triggers: Trigger[]`). Both describe the same runtime object —
 * this is the one place that bridges them (the same way
 * `getCurrentCatalog()` above already bridges the catalog file itself), so no
 * other call site needs its own cast.
 */
export function resolveCatalogParams(
  entry: CatalogEntry,
  params?: Readonly<Record<string, string>>,
): Record<string, string> {
  return resolveParams(entry as unknown as CatalogPackageEntry, params);
}

/**
 * `inlineStyle` (Task 1) across the same type bridge as `resolveCatalogParams`
 * above: the picker's card demos and the help page's demos hold entries typed
 * against the OpenAPI schema.
 */
export function catalogInlineStyle(
  entry: CatalogEntry,
  catalogVersion: string,
  params?: Readonly<Record<string, string>>,
): Record<string, string> {
  return inlineStyle(entry as unknown as CatalogPackageEntry, catalogVersion, params);
}

/** `runtimeStylesheet` across the same type bridge, for a list of entries to demo. */
export function catalogKeyframes(
  pairs: ReadonlyArray<readonly [CatalogEntry, string]>,
): string {
  return runtimeStylesheet(
    pairs.map(([entry, version]) => [entry as unknown as CatalogPackageEntry, version] as const),
  );
}

export type { Catalog, CatalogEntry };
