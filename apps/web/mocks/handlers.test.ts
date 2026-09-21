/**
 * Exercises the MSW handlers (`mocks/handlers.ts`) through the real `apiClient`
 * (`lib/api-client`), the same client the app uses — so these tests double as
 * a check that the handlers satisfy the generated contract types.
 */
import { describe, expect, it } from "vitest";

import { apiClient } from "@/lib/api-client";
import type { StaleParentError } from "@/lib/api-client";

import { CLONE_FAILURE_HOSTS, UNREACHABLE_HOST } from "./db";

/** `{ params: { path: { projectId } } }`, which every project route takes. */
const pathParams = (projectId: string) => ({ params: { path: { projectId } } });

describe("mock API: projects", () => {
  it("rejects a non-http(s)/invalid URL with the contract's validation error", async () => {
    const { response, data, error } = await apiClient.POST("/projects", {
      body: { url: "not-a-url" },
    });

    expect(response.status).toBe(400);
    expect(data).toBeUndefined();
    expect(error?.code).toBeTruthy();
    expect(error?.message).toBeTruthy();
  });

  it("reports a clone failure for a host that never resolves", async () => {
    const { response, error } = await apiClient.POST("/projects", {
      body: { url: `https://${UNREACHABLE_HOST}/page` },
    });

    expect(response.status).toBe(422);
    expect(error?.code).toBeTruthy();
  });

  // One trigger host per reason the Entry screen has to explain
  // (docs/design/README.md "1. Entry", error state 3b), carrying the service's
  // own codes and statuses (apps/api `clone/PageCloner.kt`, `Application.kt`)
  // so the screen's mapping is exercised against what it will really get.
  it.each([
    ["unreachable.test", 422, "url_unreachable"],
    ["blocked.test", 422, "url_blocked"],
    ["not-html.test", 422, "not_html"],
    ["too-large.test", 413, "page_too_large"],
    ["busy.test", 503, "clone_busy"],
    ["boom.test", 500, "internal_error"],
    // Not emitted by the service yet; see CLONE_FAILURE_HOSTS.
    ["login.test", 422, "login_required"],
    ["rate-limited.test", 429, "rate_limited"],
  ])("fails %s with %i %s", async (host, status, code) => {
    const { response, data, error } = await apiClient.POST("/projects", {
      body: { url: `https://${host}/page` },
    });

    expect(response.status).toBe(status);
    expect(data).toBeUndefined();
    expect(error?.code).toBe(code);
    expect(error?.message).toBeTruthy();
  });

  it("exposes every trigger host so tests never hard-code them", () => {
    expect(Object.values(CLONE_FAILURE_HOSTS)).toEqual(
      expect.arrayContaining([
        "unreachable.test",
        "blocked.test",
        "not-html.test",
        "too-large.test",
        "busy.test",
        "boom.test",
        "login.test",
        "rate-limited.test",
      ]),
    );
  });

  // The service parses every path id with `UUID.fromString` and maps the
  // failure to 400 `bad_request` (apps/api `routes/ProjectRoutes.kt`
  // `uuidParameter`, `Application.kt`), so a malformed id is a malformed
  // request here too — not a missing resource.
  it.each([
    ["get project", () => apiClient.GET("/projects/{projectId}", pathParams("not-a-uuid"))],
    ["delete project", () => apiClient.DELETE("/projects/{projectId}", pathParams("not-a-uuid"))],
    ["get page", () => apiClient.GET("/projects/{projectId}/page", pathParams("not-a-uuid"))],
    [
      "list versions",
      () => apiClient.GET("/projects/{projectId}/versions", pathParams("not-a-uuid")),
    ],
    ["export", () => apiClient.GET("/projects/{projectId}/export", pathParams("not-a-uuid"))],
  ])("400s %s for a projectId that is not a uuid", async (_name, call) => {
    const { response, data, error } = await call();

    expect(response.status).toBe(400);
    expect(data).toBeUndefined();
    expect(error?.code).toBe("bad_request");
    expect(error?.message).toBeTruthy();
  });

  it("400s for a versionId that is not a uuid", async () => {
    const { response, error } = await apiClient.GET(
      "/projects/{projectId}/versions/{versionId}/state",
      {
        params: {
          path: {
            projectId: "00000000-0000-0000-0000-000000000000",
            versionId: "not-a-uuid",
          },
        },
      },
    );

    expect(response.status).toBe(400);
    expect(error?.code).toBe("bad_request");
  });

  it("still 404s a well-formed id that names nothing", async () => {
    const { response, error } = await apiClient.GET("/projects/{projectId}", {
      params: { path: { projectId: "00000000-0000-0000-0000-000000000000" } },
    });

    expect(response.status).toBe(404);
    expect(error?.code).toBe("not_found");
  });

  it("404s when fetching an unknown project's page", async () => {
    const { response, error } = await apiClient.GET("/projects/{projectId}/page", {
      params: { path: { projectId: "00000000-0000-0000-0000-000000000000" } },
    });

    expect(response.status).toBe(404);
    expect(error?.code).toBeTruthy();
  });
});

describe("mock API: create -> get -> versions -> state fold -> 409 -> restore", () => {
  it("walks the full version lifecycle", async () => {
    // Create.
    const created = await apiClient.POST("/projects", {
      body: { url: "https://example.com/landing" },
    });
    expect(created.response.status).toBe(201);
    const project = created.data!;
    expect(project.currentVersionId).toBeTruthy();
    expect(project.sourceUrl).toBe("https://example.com/landing");

    // Get.
    const fetched = await apiClient.GET("/projects/{projectId}", {
      params: { path: { projectId: project.id } },
    });
    expect(fetched.data).toEqual(project);

    // Versions: exactly v0, empty diff, current === v0.
    const initialVersions = await apiClient.GET("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
    });
    expect(initialVersions.data?.versions).toHaveLength(1);
    expect(initialVersions.data?.currentVersionId).toBe(project.currentVersionId);
    const v0 = initialVersions.data!.versions[0];
    expect(v0.diff).toEqual({ set: {}, remove: [] });

    // Page (fixture) is served and tags every element with data-vm-id.
    const page = await apiClient.GET("/projects/{projectId}/page", {
      params: { path: { projectId: project.id } },
      parseAs: "text",
    });
    expect(page.response.status).toBe(200);
    expect(page.data).toContain('data-vm-id="vm-heading"');

    // Catalog to pin a real animation against.
    const catalog = await apiClient.GET("/catalog");
    const entry = catalog.data!.entries[0];

    // Save (create version).
    const saved = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: project.currentVersionId,
        catalogVersion: catalog.data!.version,
        diff: {
          set: {
            "vm-heading": {
              animationId: entry.id,
              catalogVersion: catalog.data!.version,
              trigger: entry.triggers[0],
              params: {},
            },
          },
          remove: [],
        },
      },
    });
    expect(saved.response.status).toBe(201);
    const v1 = saved.data!;
    expect(v1.seq).toBe(1);
    expect(v1.parentVersionId).toBe(v0.id);

    // State fold at v1 includes the new assignment.
    const stateAtV1 = await apiClient.GET("/projects/{projectId}/versions/{versionId}/state", {
      params: { path: { projectId: project.id, versionId: v1.id } },
    });
    expect(stateAtV1.data?.state["vm-heading"]?.animationId).toBe(entry.id);

    // Stale parent: saving again against v0 (no longer current) is a 409 that
    // carries the project's actual current version.
    const stale = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: v0.id,
        catalogVersion: catalog.data!.version,
        diff: { set: {}, remove: [] },
      },
    });
    expect(stale.response.status).toBe(409);
    const staleError = stale.error as StaleParentError | undefined;
    expect(staleError?.currentVersion.id).toBe(v1.id);

    // Restore to v0: appends a new version whose diff brings state back to v0's (empty).
    const restored = await apiClient.POST("/projects/{projectId}/versions/{versionId}/restore", {
      params: { path: { projectId: project.id, versionId: v0.id } },
      body: {},
    });
    expect(restored.response.status).toBe(201);
    const v2 = restored.data!;
    expect(v2.parentVersionId).toBe(v1.id);
    expect(v2.diff.remove).toContain("vm-heading");
    // The label the service writes when the caller sends none
    // (`apps/api/.../VersionService.kt`), so mocked runs and screenshots read
    // like production.
    expect(v2.label).toBe("Restored v0");

    const stateAtV2 = await apiClient.GET("/projects/{projectId}/versions/{versionId}/state", {
      params: { path: { projectId: project.id, versionId: v2.id } },
    });
    expect(stateAtV2.data?.state).toEqual({});

    const afterRestore = await apiClient.GET("/projects/{projectId}", {
      params: { path: { projectId: project.id } },
    });
    expect(afterRestore.data?.currentVersionId).toBe(v2.id);
  });
});

describe("mock API: 422 diff validation on createVersion", () => {
  async function createProjectAndCatalog() {
    const created = await apiClient.POST("/projects", { body: { url: "https://example.com" } });
    const project = created.data!;
    const catalog = await apiClient.GET("/catalog");
    return { project, catalog: catalog.data! };
  }

  it("422s for an unknown animationId", async () => {
    const { project, catalog } = await createProjectAndCatalog();

    const result = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: project.currentVersionId,
        catalogVersion: catalog.version,
        diff: {
          set: {
            "vm-heading": {
              animationId: "not-a-real-animation",
              catalogVersion: catalog.version,
              trigger: "load",
              params: {},
            },
          },
          remove: [],
        },
      },
    });

    expect(result.response.status).toBe(422);
    expect(result.error?.code).toBeTruthy();
  });

  it("422s for an unpublished catalogVersion", async () => {
    const { project, catalog } = await createProjectAndCatalog();
    const entry = catalog.entries[0];

    const result = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: project.currentVersionId,
        catalogVersion: catalog.version,
        diff: {
          set: {
            "vm-heading": {
              animationId: entry.id,
              catalogVersion: "9.9.9",
              trigger: entry.triggers[0],
              params: {},
            },
          },
          remove: [],
        },
      },
    });

    expect(result.response.status).toBe(422);
    expect(result.error?.code).toBeTruthy();
  });

  it("422s for an unknown param key", async () => {
    const { project, catalog } = await createProjectAndCatalog();
    const entry = catalog.entries[0];

    const result = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: project.currentVersionId,
        catalogVersion: catalog.version,
        diff: {
          set: {
            "vm-heading": {
              animationId: entry.id,
              catalogVersion: catalog.version,
              trigger: entry.triggers[0],
              params: { "not-a-real-param": "1s" },
            },
          },
          remove: [],
        },
      },
    });

    expect(result.response.status).toBe(422);
    expect(result.error?.code).toBeTruthy();
  });
});

describe("mock API: createVersion label parity with VersionService.kt", () => {
  async function createProjectAndCatalog() {
    const created = await apiClient.POST("/projects", { body: { url: "https://example.com" } });
    const project = created.data!;
    const catalog = await apiClient.GET("/catalog");
    return { project, catalog: catalog.data! };
  }

  it("400s a label over the contract's 200-character cap, mirroring the service", async () => {
    const { project, catalog } = await createProjectAndCatalog();

    const result = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: project.currentVersionId,
        catalogVersion: catalog.version,
        label: "x".repeat(201),
        diff: { set: {}, remove: [] },
      },
    });

    expect(result.response.status).toBe(400);
    expect(result.error?.message).toBe("label must be at most 200 characters");
  });

  it("generates a label when a blank one is sent, rather than keeping it verbatim", async () => {
    const { project, catalog } = await createProjectAndCatalog();
    const entry = catalog.entries[0];

    const result = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: project.currentVersionId,
        catalogVersion: catalog.version,
        label: "   ",
        diff: {
          set: {
            "vm-heading": {
              animationId: entry.id,
              catalogVersion: catalog.version,
              trigger: entry.triggers[0],
              params: {},
            },
          },
          remove: [],
        },
      },
    });

    expect(result.response.status).toBe(201);
    expect(result.data?.label).not.toBe("   ");
    expect(result.data?.label).toBeTruthy();
  });
});

describe("mock API: catalog", () => {
  it("serves the current catalog and its versions", async () => {
    const current = await apiClient.GET("/catalog");
    expect(current.data?.entries.length).toBeGreaterThan(0);

    const versions = await apiClient.GET("/catalog/versions");
    expect(versions.data?.versions).toContain(current.data!.version);

    const byVersion = await apiClient.GET("/catalog/{version}", {
      params: { path: { version: current.data!.version } },
    });
    expect(byVersion.data).toEqual(current.data);

    const missing = await apiClient.GET("/catalog/{version}", {
      params: { path: { version: "9.9.9" } },
    });
    expect(missing.response.status).toBe(404);
  });
});

describe("mock API: export", () => {
  /** A project whose v1 animates `vm-button`, with the trigger the test needs. */
  async function projectWithAnimation(trigger: "load" | "in-view" = "load") {
    const created = await apiClient.POST("/projects", { body: { url: "https://example.com" } });
    const project = created.data!;
    const catalog = await apiClient.GET("/catalog");
    const entry = catalog.data!.entries.find((candidate) => candidate.triggers.includes(trigger))!;

    const saved = await apiClient.POST("/projects/{projectId}/versions", {
      params: { path: { projectId: project.id } },
      body: {
        parentVersionId: project.currentVersionId,
        catalogVersion: catalog.data!.version,
        diff: {
          set: {
            "vm-button": {
              animationId: entry.id,
              catalogVersion: catalog.data!.version,
              trigger,
              params: {},
            },
          },
          remove: [],
        },
      },
    });

    return { projectId: project.id, versionId: saved.data!.id };
  }

  function exportOf(projectId: string, query: Record<string, string> = {}) {
    return apiClient.GET("/projects/{projectId}/export", {
      params: { path: { projectId }, query },
    });
  }

  it("exports a bundle including css for a saved assignment", async () => {
    const { projectId, versionId } = await projectWithAnimation();

    const exported = await exportOf(projectId, { versionId });

    expect(exported.response.status).toBe(200);
    expect(exported.data?.mode).toBe("full");
    expect(exported.data?.versionId).toBe(versionId);
    expect(exported.data?.html).toContain('data-vm-id="vm-heading"');
    expect(exported.data?.css).toContain("vm-button");
  });

  /*
   * The names below are the real exporter's (`apps/api/.../ExportModels.kt`,
   * plan §1.1) and the web app reads `bundle.files` for its tabs and its zip,
   * so a mock that names them differently tests a screen no deployment shows.
   * The CSS *inside* them still differs — the mock keys off `data-vm-id`, the
   * exporter off `vm-a<N>` classes — which is DT-033 and deliberate.
   */
  it("names the files as the real exporter does", async () => {
    const { projectId } = await projectWithAnimation();

    const exported = await exportOf(projectId);

    expect(exported.data?.files).toEqual([
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
    ]);
    // No in-view trigger anywhere in this version: no script, and no tab for
    // one the zip would not contain.
    expect(exported.data?.js).toBeNull();
  });

  it("adds the script, and only then, when an exported assignment is in-view", async () => {
    const { projectId } = await projectWithAnimation("in-view");

    const exported = await exportOf(projectId);

    expect(exported.data?.js).toContain("vm-in-view");
    expect(exported.data?.files.map((file) => file.name)).toEqual([
      "index.html",
      "vibe-motion.css",
      "vibe-motion.js",
    ]);
  });

  it("returns one stylesheet, and no page, for a snippet", async () => {
    const { projectId } = await projectWithAnimation();

    const exported = await exportOf(projectId, { mode: "snippet", vmId: "vm-button" });

    expect(exported.response.status).toBe(200);
    expect(exported.data?.mode).toBe("snippet");
    expect(exported.data?.html).toBeNull();
    expect(exported.data?.files).toEqual([{ name: "vibe-motion.css", contentType: "text/css" }]);
    expect(exported.data?.css).toContain("vm-button");
  });

  it("carries the script in a snippet of an in-view element", async () => {
    const { projectId } = await projectWithAnimation("in-view");

    const exported = await exportOf(projectId, { mode: "snippet", vmId: "vm-button" });

    expect(exported.data?.js).toContain("vm-in-view");
    expect(exported.data?.files.map((file) => file.name)).toEqual([
      "vibe-motion.css",
      "vibe-motion.js",
    ]);
  });

  it("404s for a snippet of an element this version does not animate", async () => {
    const { projectId } = await projectWithAnimation();

    const exported = await exportOf(projectId, { mode: "snippet", vmId: "vm-heading" });

    // An empty 200 would read as "this element has no animation" rather than
    // "you asked for the wrong element" (plan §1.6).
    expect(exported.response.status).toBe(404);
    expect(exported.error?.code).toBe("not_found");
  });

  it("400s when mode=snippet is requested without vmId", async () => {
    const created = await apiClient.POST("/projects", { body: { url: "https://example.com" } });
    const project = created.data!;

    const exported = await exportOf(project.id, { mode: "snippet" });

    expect(exported.response.status).toBe(400);
    expect(exported.error?.code).toBe("missing_vm_id");
  });

  it("404s for a version that is not this project's", async () => {
    const { projectId } = await projectWithAnimation();

    const exported = await exportOf(projectId, {
      versionId: "11111111-1111-4111-8111-111111111111",
    });

    expect(exported.response.status).toBe(404);
  });
});
