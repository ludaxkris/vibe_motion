/**
 * Build-time access to the animation catalog.
 *
 * Phase 0 read the published catalog file directly. Phase 3 switches to the
 * `animation-catalog` package (`CATALOGS`/`CURRENT_VERSION`/`getCatalog`) so
 * every consumer — this module, the runtime CSS generator, the bridge — agrees
 * on the same immutable versions. Phase 4+ swaps this for `GET /catalog` where
 * a live catalog is needed; assignments always resolve against the version
 * they pinned.
 */
import { CURRENT_VERSION, getCatalog as getCatalogByVersion } from "animation-catalog";

import type { Catalog, CatalogEntry } from "@/lib/api-client";

/**
 * Mirrors `packages/animation-catalog/current`. The editor authors against this
 * version; every saved assignment pins the version it was authored with.
 */
export const CURRENT_CATALOG_VERSION: string = CURRENT_VERSION;

const catalog = getCatalogByVersion(CURRENT_VERSION) as unknown as Catalog;

/** The catalog the editor currently authors against. */
export function getCatalog(): Catalog {
  return catalog;
}

/** Every entry in the current catalog, in file order. */
export function getCatalogEntries(): readonly CatalogEntry[] {
  return catalog.entries;
}

/** One entry by id, or `undefined` when the id is not in the current catalog. */
export function getCatalogEntry(id: string): CatalogEntry | undefined {
  return catalog.entries.find((entry) => entry.id === id);
}

export type { Catalog, CatalogEntry };
