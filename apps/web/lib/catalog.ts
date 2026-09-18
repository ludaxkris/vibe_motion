/**
 * Build-time access to the animation catalog.
 *
 * Phase 0 reads the published catalog file directly so the help page renders
 * without the API. `packages/animation-catalog/versions/*.json` files are
 * immutable once merged (CLAUDE.md), so importing one is safe and cache-free.
 * Phase 3+ swaps this for `GET /catalog` where a live catalog is needed;
 * assignments always resolve against the version they pinned.
 */
import catalogJson from "../../../packages/animation-catalog/versions/1.0.0.json";

import type { Catalog, CatalogEntry } from "@/lib/api-client";

/**
 * Mirrors `packages/animation-catalog/current`. The editor authors against this
 * version; every saved assignment pins the version it was authored with.
 */
export const CURRENT_CATALOG_VERSION = "1.0.0";

const catalog = catalogJson as unknown as Catalog;

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
