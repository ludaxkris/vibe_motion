/**
 * In-memory store behind the MSW mock handlers (`mocks/handlers.ts`).
 *
 * Mirrors the contract's state model (docs/build_plan.md Phase 2, `apps/api/openapi.yaml`):
 * a project holds an ordered list of versions; version 0 has an empty diff;
 * each later version stores a diff from its parent; full state at a version is
 * the fold of every diff from v0 applying `set` then `remove`, in order.
 *
 * `resetDb()` clears everything between tests (wired into `vitest.setup.ts`).
 */
import { CURRENT_VERSION as CURRENT_CATALOG_VERSION, getEntry } from "animation-catalog";
import type { CatalogEntry } from "animation-catalog";

import type {
  Assignment,
  Diff,
  EditorStateMap,
  Error as ApiError,
  ExportBundle,
  Project,
  StaleParentError,
  Version,
} from "@/lib/api-client";
import { assignmentStyle, runtimeStylesheet } from "@/lib/runtime-css";

import { pageFixtureHtml } from "./fixtures/page";

type ProjectRecord = {
  project: Project;
  /** Ascending by `seq`; `versions[0]` is always version 0 (empty diff). */
  versions: Version[];
};

const projects = new Map<string, ProjectRecord>();

/** Host that always fails cloning in the mock, for testing the clone-failure path. */
export const UNREACHABLE_HOST = "unreachable.test";

export function resetDb(): void {
  projects.clear();
}

function isHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function err(code: string, message: string, details?: Record<string, unknown>): ApiError {
  return details ? { code, message, details } : { code, message };
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type CreateProjectResult =
  | { status: 201; body: Project }
  | { status: 400; body: ApiError }
  | { status: 422; body: ApiError };

export function createProject(url: string): CreateProjectResult {
  const parsed = isHttpUrl(url);
  if (!parsed) {
    return {
      status: 400,
      body: err("invalid_url", "url must be an absolute http(s) URL", { url }),
    };
  }
  if (parsed.hostname === UNREACHABLE_HOST) {
    return {
      status: 422,
      body: err("clone_failed", `Could not reach ${url}`, { url }),
    };
  }

  const now = new Date().toISOString();
  const projectId = crypto.randomUUID();
  const versionId = crypto.randomUUID();

  const v0: Version = {
    id: versionId,
    projectId,
    parentVersionId: null,
    seq: 0,
    label: "Initial clone",
    catalogVersion: CURRENT_CATALOG_VERSION,
    diff: { set: {}, remove: [] },
    createdAt: now,
  };

  const project: Project = {
    id: projectId,
    sourceUrl: url,
    title: parsed.hostname,
    currentVersionId: versionId,
    createdAt: now,
  };

  projects.set(projectId, { project, versions: [v0] });
  return { status: 201, body: project };
}

export function getProject(projectId: string): Project | undefined {
  return projects.get(projectId)?.project;
}

export function deleteProject(projectId: string): boolean {
  return projects.delete(projectId);
}

export function getProjectPageHtml(projectId: string): string | undefined {
  return projects.has(projectId) ? pageFixtureHtml : undefined;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export function listVersions(
  projectId: string,
): { currentVersionId: string; versions: Version[] } | undefined {
  const record = projects.get(projectId);
  if (!record) return undefined;
  return { currentVersionId: record.project.currentVersionId, versions: record.versions };
}

/** Fold every diff from v0 through `versionId`, applying `set` then `remove` at each step. */
export function stateAtVersion(
  record: ProjectRecord,
  versionId: string,
): EditorStateMap | undefined {
  const index = record.versions.findIndex((v) => v.id === versionId);
  if (index === -1) return undefined;

  const state: EditorStateMap = {};
  for (let i = 0; i <= index; i += 1) {
    const { diff } = record.versions[i];
    for (const [vmId, assignment] of Object.entries(diff.set)) {
      state[vmId] = assignment;
    }
    for (const vmId of diff.remove) {
      delete state[vmId];
    }
  }
  return state;
}

export function getVersionState(
  projectId: string,
  versionId: string,
): { versionId: string; state: EditorStateMap } | undefined {
  const record = projects.get(projectId);
  if (!record) return undefined;
  const state = stateAtVersion(record, versionId);
  if (!state) return undefined;
  return { versionId, state };
}

export type CreateVersionInput = {
  parentVersionId: string;
  catalogVersion: string;
  label?: string;
  diff: Diff;
};

/** Validates every assignment in `diff.set` against the pinned catalog version + animation id. */
function validateDiff(diff: Diff): ApiError | undefined {
  for (const [vmId, assignment] of Object.entries(diff.set)) {
    const entry = getEntry(assignment.catalogVersion, assignment.animationId);
    if (!entry) {
      return err(
        "unknown_animation",
        `No animation "${assignment.animationId}" in catalog ${assignment.catalogVersion}`,
        { vmId },
      );
    }
    const knownKeys = new Set(entry.params.map((p) => p.key));
    for (const key of Object.keys(assignment.params)) {
      if (!knownKeys.has(key)) {
        return err("invalid_param", `Unknown param "${key}" for animation "${entry.id}"`, {
          vmId,
          key,
        });
      }
    }
  }
  return undefined;
}

export type CreateVersionResult =
  | { status: 201; body: Version }
  | { status: 404; body: ApiError }
  | { status: 409; body: StaleParentError }
  | { status: 422; body: ApiError };

export function createVersion(
  projectId: string,
  input: CreateVersionInput,
): CreateVersionResult {
  const record = projects.get(projectId);
  if (!record) return { status: 404, body: err("not_found", `No project ${projectId}`) };

  if (input.parentVersionId !== record.project.currentVersionId) {
    const currentVersion = record.versions.at(-1) as Version;
    return {
      status: 409,
      body: {
        code: "stale_parent",
        message: "parentVersionId is not the project's current version",
        currentVersion,
      },
    };
  }

  const invalid = validateDiff(input.diff);
  if (invalid) return { status: 422, body: invalid };

  const last = record.versions.at(-1) as Version;
  const version: Version = {
    id: crypto.randomUUID(),
    projectId,
    parentVersionId: input.parentVersionId,
    seq: last.seq + 1,
    label: input.label ?? defaultLabel(input.diff),
    catalogVersion: input.catalogVersion,
    diff: input.diff,
    createdAt: new Date().toISOString(),
  };

  record.versions.push(version);
  record.project = { ...record.project, currentVersionId: version.id };
  return { status: 201, body: version };
}

function defaultLabel(diff: Diff): string {
  const setCount = Object.keys(diff.set).length;
  const removeCount = diff.remove.length;
  const parts: string[] = [];
  if (setCount > 0) parts.push(`${setCount} set`);
  if (removeCount > 0) parts.push(`${removeCount} removed`);
  return parts.length > 0 ? parts.join(", ") : "No changes";
}

export type RestoreVersionResult = { status: 404; body: ApiError } | CreateVersionResult;

export function restoreVersion(
  projectId: string,
  targetVersionId: string,
  label?: string,
): RestoreVersionResult {
  const record = projects.get(projectId);
  if (!record) return { status: 404, body: err("not_found", `No project ${projectId}`) };

  const targetState = stateAtVersion(record, targetVersionId);
  if (!targetState) {
    return { status: 404, body: err("not_found", `No version ${targetVersionId}`) };
  }

  const currentState = stateAtVersion(record, record.project.currentVersionId) ?? {};

  const set: Record<string, Assignment> = {};
  for (const [vmId, assignment] of Object.entries(targetState)) {
    if (JSON.stringify(currentState[vmId]) !== JSON.stringify(assignment)) {
      set[vmId] = assignment;
    }
  }
  const remove = Object.keys(currentState).filter((vmId) => !(vmId in targetState));

  const targetVersion = record.versions.find((v) => v.id === targetVersionId) as Version;

  return createVersion(projectId, {
    parentVersionId: record.project.currentVersionId,
    catalogVersion: targetVersion.catalogVersion,
    label: label ?? `Restored to "${targetVersion.label}"`,
    diff: { set, remove },
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportOptions = {
  versionId?: string;
  mode?: "full" | "snippet";
  vmId?: string;
};

export type ExportResult =
  | { status: 200; body: ExportBundle }
  | { status: 400; body: ApiError }
  | { status: 404; body: ApiError };

export function exportProject(projectId: string, options: ExportOptions): ExportResult {
  const record = projects.get(projectId);
  if (!record) return { status: 404, body: err("not_found", `No project ${projectId}`) };

  const versionId = options.versionId ?? record.project.currentVersionId;
  const mode = options.mode ?? "full";

  if (mode === "snippet" && !options.vmId) {
    return { status: 400, body: err("missing_vm_id", "vmId is required when mode=snippet") };
  }

  const fullState = stateAtVersion(record, versionId);
  if (!fullState) return { status: 404, body: err("not_found", `No version ${versionId}`) };

  const state: EditorStateMap =
    mode === "snippet" && options.vmId
      ? options.vmId in fullState
        ? { [options.vmId]: fullState[options.vmId] }
        : {}
      : fullState;

  const pairs: Array<readonly [CatalogEntry, string]> = [];
  const rules: string[] = [];
  let hasInViewTrigger = false;

  for (const [vmId, assignment] of Object.entries(state)) {
    const entry = getEntry(assignment.catalogVersion, assignment.animationId);
    if (!entry) continue; // catalog data integrity issue, not this endpoint's job to surface
    pairs.push([entry, assignment.catalogVersion]);
    if (assignment.trigger === "in-view") hasInViewTrigger = true;

    const style = assignmentStyle(entry, assignment.catalogVersion, assignment.params);
    const declarations = Object.entries(style)
      .map(([prop, value]) => `  ${prop}: ${value};`)
      .join("\n");
    rules.push(`[data-vm-id="${vmId}"] {\n${declarations}\n}`);
  }

  const css = [runtimeStylesheet(pairs), rules.join("\n\n")].filter(Boolean).join("\n\n");
  const js = hasInViewTrigger
    ? `document.querySelectorAll('[data-vm-trigger="in-view"]').forEach((el) => {\n` +
      `  new IntersectionObserver((entries) => {\n` +
      `    entries.forEach((entry) => entry.target.classList.toggle('vm-in-view', entry.isIntersecting));\n` +
      `  }).observe(el);\n` +
      `});\n`
    : null;

  const files: ExportBundle["files"] =
    mode === "full"
      ? [
          { name: "index.html", contentType: "text/html" },
          { name: "styles.css", contentType: "text/css" },
          ...(js ? [{ name: "script.js", contentType: "text/javascript" }] : []),
        ]
      : [{ name: "snippet.css", contentType: "text/css" }];

  return {
    status: 200,
    body: {
      versionId,
      mode,
      html: mode === "full" ? pageFixtureHtml : null,
      css,
      js,
      files,
    },
  };
}

