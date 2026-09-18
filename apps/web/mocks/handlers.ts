/**
 * MSW request handlers for every path in `apps/api/openapi.yaml`.
 *
 * Shared between `server.ts` (msw/node, used by vitest) and `browser.ts`
 * (msw/browser, used by the dev server / Playwright e2e when
 * `NEXT_PUBLIC_API_MOCKING=enabled`). Backed by the in-memory store in `db.ts`.
 *
 * Response bodies are typed against `components`/`operations` from
 * `lib/api-client/schema.d.ts` (via `@/lib/api-client`), so a renamed or
 * removed contract field fails typecheck here rather than silently drifting.
 */
import { CATALOGS, CATALOG_VERSIONS, CURRENT_VERSION, getCatalog } from "animation-catalog";
import { HttpResponse, http } from "msw";

import type {
  Catalog,
  CreateVersionRequest,
  Diff,
  Error as ApiError,
  ExportBundle,
  Health,
  Project,
  Version,
} from "@/lib/api-client";
import { env } from "@/lib/env";

import {
  createProject,
  createVersion,
  deleteProject,
  exportProject,
  getProject,
  getProjectPageHtml,
  getVersionState,
  listVersions,
  restoreVersion,
} from "./db";

const api = (path: string): string => `${env.apiOrigin}${path}`;

export const handlers = [
  http.get(api("/health"), () => {
    const body: Health = { status: "ok", db: "ok", version: "mock" };
    return HttpResponse.json(body);
  }),

  // -- Catalog ---------------------------------------------------------------

  http.get(api("/catalog"), () => {
    const catalog = CATALOGS[CURRENT_VERSION] as unknown as Catalog;
    return HttpResponse.json(catalog);
  }),

  http.get(api("/catalog/versions"), () => {
    return HttpResponse.json({ current: CURRENT_VERSION, versions: CATALOG_VERSIONS });
  }),

  http.get(api("/catalog/:version"), ({ params }) => {
    const version = params.version as string;
    const catalog = getCatalog(version) as unknown as Catalog | undefined;
    if (!catalog) {
      const body: ApiError = { code: "not_found", message: `No catalog version ${version}` };
      return HttpResponse.json(body, { status: 404 });
    }
    return HttpResponse.json(catalog);
  }),

  // -- Projects ---------------------------------------------------------------

  http.post(api("/projects"), async ({ request }) => {
    const body = (await request.json()) as { url: string };
    const result = createProject(body.url);
    return HttpResponse.json(result.body, { status: result.status });
  }),

  http.get(api("/projects/:projectId"), ({ params }) => {
    const project = getProject(params.projectId as string);
    if (!project) {
      const body: ApiError = { code: "not_found", message: "No such project" };
      return HttpResponse.json(body, { status: 404 });
    }
    return HttpResponse.json(project satisfies Project);
  }),

  http.delete(api("/projects/:projectId"), ({ params }) => {
    const deleted = deleteProject(params.projectId as string);
    if (!deleted) {
      const body: ApiError = { code: "not_found", message: "No such project" };
      return HttpResponse.json(body, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  http.get(api("/projects/:projectId/page"), ({ params }) => {
    const html = getProjectPageHtml(params.projectId as string);
    if (html === undefined) {
      const body: ApiError = { code: "not_found", message: "No such project" };
      return HttpResponse.json(body, { status: 404 });
    }
    return HttpResponse.html(html);
  }),

  // -- Versions ---------------------------------------------------------------

  http.get(api("/projects/:projectId/versions"), ({ params }) => {
    const result = listVersions(params.projectId as string);
    if (!result) {
      const body: ApiError = { code: "not_found", message: "No such project" };
      return HttpResponse.json(body, { status: 404 });
    }
    return HttpResponse.json(result);
  }),

  http.post(api("/projects/:projectId/versions"), async ({ params, request }) => {
    const body = (await request.json()) as CreateVersionRequest;
    const diff: Diff = body.diff;
    const result = createVersion(params.projectId as string, {
      parentVersionId: body.parentVersionId,
      catalogVersion: body.catalogVersion,
      label: body.label,
      diff,
    });
    return HttpResponse.json(result.body, { status: result.status });
  }),

  http.get(api("/projects/:projectId/versions/:versionId/state"), ({ params }) => {
    const result = getVersionState(params.projectId as string, params.versionId as string);
    if (!result) {
      const body: ApiError = { code: "not_found", message: "No such project or version" };
      return HttpResponse.json(body, { status: 404 });
    }
    return HttpResponse.json(result);
  }),

  http.post(api("/projects/:projectId/versions/:versionId/restore"), async ({ params, request }) => {
    let label: string | undefined;
    try {
      const body = (await request.json()) as { label?: string } | null;
      label = body?.label;
    } catch {
      label = undefined;
    }
    const result = restoreVersion(params.projectId as string, params.versionId as string, label);
    return HttpResponse.json(result.body satisfies Version | ApiError, {
      status: result.status,
    });
  }),

  // -- Export -------------------------------------------------------------

  http.get(api("/projects/:projectId/export"), ({ params, request }) => {
    const url = new URL(request.url);
    const versionId = url.searchParams.get("versionId") ?? undefined;
    const mode = (url.searchParams.get("mode") as "full" | "snippet" | null) ?? undefined;
    const vmId = url.searchParams.get("vmId") ?? undefined;

    const result = exportProject(params.projectId as string, { versionId, mode, vmId });
    return HttpResponse.json(result.body satisfies ExportBundle | ApiError, {
      status: result.status,
    });
  }),
];
