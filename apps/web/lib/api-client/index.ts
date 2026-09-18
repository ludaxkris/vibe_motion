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

export type { components, paths };
