/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source of truth: apps/api/openapi.yaml (the frozen Phase 0 contract).
 * Regenerate with `pnpm --filter web gen:client` (or `pnpm gen:client` at the repo root).
 * Hand edits will be lost and will silently desynchronise web from the API.
 */

export interface paths {
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Liveness and DB reachability */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** The catalog version the editor authors against (`current`) */
        get: operations["getCurrentCatalog"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** All published catalog versions */
        get: operations["listCatalogVersions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/catalog/{version}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** One published catalog version */
        get: operations["getCatalogVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Clone a page and create a project with version 0 */
        post: operations["createProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        /** Project metadata and current version pointer */
        get: operations["getProject"];
        put?: never;
        post?: never;
        /** Delete a project and all versions (used by e2e cleanup) */
        delete: operations["deleteProject"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/page": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        /**
         * The cloned page with the bridge script injected. Used as the editor iframe `src`.
         * @description `base_html` is immutable, so the response is a pure function of the project id and the
         *     renderer and carries a strong `ETag`. It is sent `private, no-cache`: always revalidate,
         *     never serve stale — a deleted project must 404 and a CSP fix must not wait out a max-age.
         *     A revalidation hit answers 304 without reading the stored document.
         */
        get: operations["getProjectPage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/bridge/vm-bridge.js": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * The Vibe Motion bridge script loaded by the rendered project page (added in Phase 2, additive)
         * @description `GET /projects/{projectId}/page` adds `<script src="/bridge/vm-bridge.js">` and a CSP of
         *     `script-src 'self'` at serve time, so this is the only script a cloned page can run.
         *     The stored `base_html` never contains it.
         *
         *     Sent `no-cache` with a content-hash `ETag`: the bridge evolves with the editor, and a
         *     stale bridge talking to a newer shell is worse than a conditional request per page view.
         */
        get: operations["getBridgeScript"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        /** Version history, ascending by seq */
        get: operations["listVersions"];
        put?: never;
        /** Save. Append a version holding the diff from the current version. */
        post: operations["createVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/versions/{versionId}/state": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
                versionId: components["parameters"]["versionId"];
            };
            cookie?: never;
        };
        /** Materialised full state at this version (fold of diffs v0..N) */
        get: operations["getVersionState"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/versions/{versionId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
                versionId: components["parameters"]["versionId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a new version whose diff returns the project to this version's state */
        post: operations["restoreVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/projects/{projectId}/export": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        /** HTML, CSS and optional JS for a saved version */
        get: operations["exportProject"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @example 1.0.0 */
        Semver: string;
        Health: {
            /** @enum {string} */
            status: "ok" | "degraded";
            /** @enum {string} */
            db: "ok" | "down";
            /** @description Build version or git sha */
            version?: string;
        };
        Error: {
            code: string;
            message: string;
            details?: {
                [key: string]: unknown;
            };
        };
        StaleParentError: components["schemas"]["Error"] & {
            currentVersion: components["schemas"]["Version"];
        };
        /** @description Mirrors packages/animation-catalog/schema.json. Kept loose here; the JSON Schema is authoritative. */
        Catalog: {
            version: components["schemas"]["Semver"];
            entries: components["schemas"]["CatalogEntry"][];
        };
        CatalogEntry: {
            id: string;
            name: string;
            /** @enum {string} */
            category: "entrance" | "exit" | "attention" | "emphasis" | "continuous" | "hover";
            description: string;
            keyframes: string;
            params: components["schemas"]["CatalogParam"][];
            triggers: components["schemas"]["Trigger"][];
            defaultTrigger?: components["schemas"]["Trigger"];
            baseStyles?: string;
        };
        CatalogParam: {
            key: string;
            label?: string;
            /** @enum {string} */
            type: "duration" | "easing" | "iteration" | "direction" | "length" | "number" | "angle" | "percentage" | "color" | "select";
            default: string;
            min?: string;
            max?: string;
            step?: string;
            options?: string[];
            cssVar?: string;
        };
        /** @enum {string} */
        Trigger: "load" | "hover" | "in-view";
        Project: {
            /** Format: uuid */
            id: string;
            /** Format: uri */
            sourceUrl: string;
            title: string;
            /**
             * Format: uuid
             * @description Always present. The DB column is nullable only because projects and versions reference
             *     each other (deferrable FK); the API creates a project and its version 0 in one transaction
             *     and never exposes a project without a current version.
             */
            currentVersionId: string;
            /** Format: date-time */
            createdAt: string;
        };
        /** @description One element's animation. CSS is derived from (animationId, catalogVersion) + params. */
        Assignment: {
            animationId: string;
            catalogVersion: components["schemas"]["Semver"];
            trigger: components["schemas"]["Trigger"];
            /** @description Param key to CSS value string. Keys must exist on the catalog entry. */
            params: {
                [key: string]: string;
            };
        };
        /** @description Materialised map of data-vm-id to Assignment. */
        State: {
            [key: string]: components["schemas"]["Assignment"];
        };
        /** @description Delta from the parent version. `set` is applied, then `remove`. */
        Diff: {
            set: {
                [key: string]: components["schemas"]["Assignment"];
            };
            remove: string[];
        };
        Version: {
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            projectId: string;
            /** Format: uuid */
            parentVersionId: string | null;
            seq: number;
            label: string;
            /** @description Catalog the editor authored against at save time (informational; the pin that matters is per assignment). */
            catalogVersion: components["schemas"]["Semver"];
            diff: components["schemas"]["Diff"];
            /** Format: date-time */
            createdAt: string;
        };
        CreateVersionRequest: {
            /** Format: uuid */
            parentVersionId: string;
            catalogVersion: components["schemas"]["Semver"];
            /** @description Optional; server generates one from the diff when omitted */
            label?: string;
            diff: components["schemas"]["Diff"];
        };
        ExportBundle: {
            /** Format: uuid */
            versionId: string;
            /** @enum {string} */
            mode: "full" | "snippet";
            /** @description Full page in mode=full. Null in snippet mode. */
            html: string | null;
            css: string;
            /** @description Present only when some assignment uses the in-view trigger. */
            js: string | null;
            /** @description Suggested file names for the zip, in order */
            files: {
                name: string;
                contentType: string;
            }[];
        };
    };
    responses: {
        /** @description Not found */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /** @description Malformed request */
        BadRequest: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /**
         * @description `payload_too_large`: the JSON request body exceeds 256 KB. Enforced from `Content-Length`
         *     and again while reading, so a chunked body is cut off at the same limit.
         */
        PayloadTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
        /**
         * @description `project_busy`: the project row lock could not be taken within the transaction's
         *     `lock_timeout`, so another save or restore on the same project is still in flight. Retry.
         */
        ProjectBusy: {
            headers: {
                "Retry-After": components["headers"]["RetryAfter"];
                [name: string]: unknown;
            };
            content: {
                "application/json": components["schemas"]["Error"];
            };
        };
    };
    parameters: {
        projectId: string;
        versionId: string;
    };
    requestBodies: never;
    headers: {
        /** @description Seconds to wait before retrying the same request. */
        RetryAfter: number;
        /** @description Strong validator. Send it back as `If-None-Match` to revalidate. */
        ETag: string;
        /** @description Always revalidate; never serve a stale copy. */
        CacheControl: string;
    };
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Service is up */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            /** @description Service up but a dependency is down */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
        };
    };
    getCurrentCatalog: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Catalog */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Catalog"];
                };
            };
        };
    };
    listCatalogVersions: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Versions, ascending semver */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        current: components["schemas"]["Semver"];
                        versions: components["schemas"]["Semver"][];
                    };
                };
            };
        };
    };
    getCatalogVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                version: components["schemas"]["Semver"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Catalog */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Catalog"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    createProject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * Format: uri
                     * @description Public http(s) URL. Private, loopback, link-local and metadata ranges are rejected.
                     */
                    url: string;
                };
            };
        };
        responses: {
            /** @description Project created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            400: components["responses"]["BadRequest"];
            /**
             * @description Either the request body exceeds the 256 KB JSON limit (`payload_too_large`) or the
             *     source page exceeds the clone size cap (`page_too_large`). The `code` tells them apart.
             */
            413: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description URL blocked (SSRF guard) or unreachable */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            /**
             * @description `clone_busy`: this instance is already running its maximum number of concurrent clones.
             *     A clone can peak above 100 MB of heap, so the limit protects the instance. Retry.
             */
            503: {
                headers: {
                    "Retry-After": components["headers"]["RetryAfter"];
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    getProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Project */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Project"];
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    deleteProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["NotFound"];
        };
    };
    getProjectPage: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from a previous response. A match answers 304. */
                "If-None-Match"?: string;
            };
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description HTML document */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Cache-Control": components["headers"]["CacheControl"];
                    /** @description Policy the browser enforces for the cloned document; also present as a meta tag. */
                    "Content-Security-Policy"?: string;
                    /** @description Always `no-referrer` — the project URL is a capability in v0. */
                    "Referrer-Policy"?: string;
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
            /** @description Not modified; the cached document is still current */
            304: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Cache-Control": components["headers"]["CacheControl"];
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: components["responses"]["NotFound"];
        };
    };
    getBridgeScript: {
        parameters: {
            query?: never;
            header?: {
                /** @description The `ETag` from a previous response. A match answers 304. */
                "If-None-Match"?: string;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description JavaScript */
            200: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Cache-Control": components["headers"]["CacheControl"];
                    [name: string]: unknown;
                };
                content: {
                    "application/javascript": string;
                };
            };
            /** @description Not modified; the cached script is still current */
            304: {
                headers: {
                    ETag: components["headers"]["ETag"];
                    "Cache-Control": components["headers"]["CacheControl"];
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    listVersions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Versions */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        currentVersionId: string;
                        versions: components["schemas"]["Version"][];
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    createVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateVersionRequest"];
            };
        };
        responses: {
            /** @description Version created and made current */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Version"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            /** @description parentVersionId is not the project's current version (saved elsewhere) */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["StaleParentError"];
                };
            };
            413: components["responses"]["PayloadTooLarge"];
            /**
             * @description Diff references an unknown catalog version or animation id, has an undeclared or
             *     malformed param value, or exceeds the 2,000 entry cap (`invalid_diff`).
             */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            503: components["responses"]["ProjectBusy"];
        };
    };
    getVersionState: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
                versionId: components["parameters"]["versionId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description State */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** Format: uuid */
                        versionId: string;
                        state: components["schemas"]["State"];
                    };
                };
            };
            404: components["responses"]["NotFound"];
        };
    };
    restoreVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
                versionId: components["parameters"]["versionId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": {
                    label?: string;
                };
            };
        };
        responses: {
            /**
             * @description New version created and made current. Same shape as `createVersion`'s 201; its
             *     `catalogVersion` is the TARGET version's, so a restored version reads as a copy of
             *     what it reproduces.
             */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Version"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
            413: components["responses"]["PayloadTooLarge"];
            503: components["responses"]["ProjectBusy"];
        };
    };
    exportProject: {
        parameters: {
            query?: {
                /** @description Defaults to the current version */
                versionId?: string;
                mode?: "full" | "snippet";
                /** @description Required when mode=snippet. Export only this element's assignment. */
                vmId?: string;
            };
            header?: never;
            path: {
                projectId: components["parameters"]["projectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Export bundle */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ExportBundle"];
                };
            };
            400: components["responses"]["BadRequest"];
            404: components["responses"]["NotFound"];
        };
    };
}
