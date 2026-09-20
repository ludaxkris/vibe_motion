/**
 * The version endpoints as outcomes the UI can switch on, instead of
 * `{ data, error, response }` triples. No React here: the hooks in
 * `queries.ts` and the e2e-free unit tests both call these directly.
 */
import { apiClient, type ApiError, type CreateVersionRequest, type EditorStateMap, type StaleParentError, type Version } from "@/lib/api-client";

export type WriteOutcome =
  | { kind: "saved"; version: Version }
  | { kind: "stale"; currentVersion: Version }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "busy"; retryAfterSeconds: number }
  | { kind: "failed"; message: string };

const DEFAULT_RETRY_AFTER_SECONDS = 1;

function outcome(data: Version | undefined, error: unknown, response: Response): WriteOutcome {
  if (data) return { kind: "saved", version: data };
  const body = (error ?? {}) as Partial<ApiError & StaleParentError>;
  const message = body.message ?? `Request failed (${response.status})`;
  if (response.status === 409 && body.currentVersion) return { kind: "stale", currentVersion: body.currentVersion };
  if (response.status === 503) {
    const seconds = Number(response.headers.get("Retry-After"));
    return { kind: "busy", retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS };
  }
  if ([400, 413, 422].includes(response.status)) return { kind: "rejected", code: body.code ?? "rejected", message };
  return { kind: "failed", message };
}

async function guarded(call: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
  try {
    return await call();
  } catch (cause) {
    return { kind: "failed", message: cause instanceof Error ? cause.message : "Network error" };
  }
}

export function saveVersion(projectId: string, body: CreateVersionRequest): Promise<WriteOutcome> {
  return guarded(async () => {
    const { data, error, response } = await apiClient.POST("/projects/{projectId}/versions", { params: { path: { projectId } }, body });
    return outcome(data, error, response);
  });
}

export function restoreVersion(projectId: string, versionId: string, label?: string): Promise<WriteOutcome> {
  return guarded(async () => {
    const { data, error, response } = await apiClient.POST("/projects/{projectId}/versions/{versionId}/restore", {
      params: { path: { projectId, versionId } },
      body: label === undefined ? {} : { label },
    });
    return outcome(data, error, response);
  });
}

export async function fetchVersionState(projectId: string, versionId: string): Promise<EditorStateMap> {
  const { data, error } = await apiClient.GET("/projects/{projectId}/versions/{versionId}/state", { params: { path: { projectId, versionId } } });
  if (!data) throw new Error((error as ApiError | undefined)?.message ?? "Could not load this version");
  return data.state;
}

export async function fetchVersions(projectId: string): Promise<{ currentVersionId: string; versions: Version[] }> {
  const { data, error } = await apiClient.GET("/projects/{projectId}/versions", { params: { path: { projectId } } });
  if (!data) throw new Error((error as ApiError | undefined)?.message ?? "Could not load version history");
  return data;
}
