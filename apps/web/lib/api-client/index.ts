/**
 * Typed client for the Vibe Motion API.
 *
 * Types come from `schema.d.ts`, which is generated from `apps/api/openapi.yaml`
 * by `pnpm gen:client`. Never hand-edit the schema file.
 */
import createClient from "openapi-fetch";

import { env } from "@/lib/env";

import type { components, paths } from "./schema";

export const apiClient = createClient<paths>({ baseUrl: env.apiOrigin });

/** Convenience aliases for the schemas the editor works with. */
export type Project = components["schemas"]["Project"];
export type Version = components["schemas"]["Version"];
export type Assignment = components["schemas"]["Assignment"];
export type EditorStateMap = components["schemas"]["State"];
export type Diff = components["schemas"]["Diff"];
export type Catalog = components["schemas"]["Catalog"];
export type CatalogEntry = components["schemas"]["CatalogEntry"];
export type CatalogParam = components["schemas"]["CatalogParam"];
export type Trigger = components["schemas"]["Trigger"];
/**
 * The contract's error body. Named `ApiError` rather than `Error`: an export
 * called `Error` shadows the global in any module that imports it, so every
 * importer had to rename it at the import site anyway — and one that forgot
 * would silently type `new Error(...)` against a plain `{ code, message }`.
 */
export type ApiError = components["schemas"]["Error"];
export type StaleParentError = components["schemas"]["StaleParentError"];
export type ExportBundle = components["schemas"]["ExportBundle"];
export type CreateVersionRequest = components["schemas"]["CreateVersionRequest"];
export type Health = components["schemas"]["Health"];

export type { components, paths };
