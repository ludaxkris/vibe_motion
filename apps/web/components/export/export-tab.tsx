"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiClient, type EditorStateMap, type ExportBundle } from "@/lib/api-client";

import { type ExportMode, ExportPanel } from "./export-panel";
import { exportCounts } from "./export-stats";

/** Thrown by `fetchExport` so the tab can show what the API actually said. */
export class ExportFetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ExportFetchError";
  }
}

/**
 * `openapi-fetch` parses the error body as JSON and, when that fails, hands
 * back the raw text instead — a proxy's `text/html` 502 page, say. Taking
 * `.message` off that gives `undefined`, and an `Error` with an empty message
 * renders as an empty red line above a bare Retry. Fall back to the status.
 */
export function exportErrorMessage(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return `Could not build this export (HTTP ${status}).`;
}

async function fetchExport(
  projectId: string,
  query: { versionId: string; mode: ExportMode; vmId?: string },
): Promise<ExportBundle> {
  const { data, error, response } = await apiClient.GET("/projects/{projectId}/export", {
    params: { path: { projectId }, query },
  });
  if (error) throw new ExportFetchError(response.status, exportErrorMessage(error, response.status));
  return data;
}

export type ExportTabProps = {
  projectId: string;
  /** Always explicit: a saved version is immutable, which is what lets the
   *  query cache it for the session. */
  versionId: string;
  versionSeq: number;
  /** Defaults to `v<seq>`. */
  versionLabel?: string;
  isCurrent: boolean;
  /** The element selected on the page, if any — what a snippet is of. */
  selectedVmId?: string | null;
  /** That version's materialised state, for the footer's counts. */
  state?: EditorStateMap;
  /** That state could not be loaded: the counts and Snippet are unavailable, the export is not. */
  stateError?: { onRetry: () => void };
  /** The project's name; only the download file name ever sees it. */
  projectSlug?: string;
};

/**
 * The Export tab, wired to `GET /projects/{projectId}/export`.
 *
 * Mounted by `components/control-panel/export-section.tsx`, which is also
 * where the version this is asked for is decided (plan §5.2: the project's
 * current version, or the one the reader pinned by opening Export while
 * viewing it). `/dev/export` renders the presentational half from fixed props.
 */
export function ExportTab({
  projectId,
  versionId,
  versionSeq,
  versionLabel,
  isCurrent,
  selectedVmId,
  state,
  stateError,
  projectSlug,
}: ExportTabProps) {
  const [mode, setMode] = useState<ExportMode>("full");

  const snippetAssignment = selectedVmId ? state?.[selectedVmId] : undefined;
  const snippetAvailable = snippetAssignment !== undefined;
  // A snippet needs an animated element. Losing the selection falls back to
  // the full page rather than leaving a mode that cannot be asked for.
  const effectiveMode: ExportMode = snippetAvailable && mode === "snippet" ? "snippet" : "full";
  const vmId = effectiveMode === "snippet" ? (selectedVmId ?? undefined) : undefined;

  const query = useQuery({
    queryKey: ["project", projectId, "export", versionId, effectiveMode, vmId ?? null],
    queryFn: () => fetchExport(projectId, { versionId, mode: effectiveMode, vmId }),
    // A saved version is immutable and so is the export of it. Only a new
    // build of the API could change these bytes, and that reloads the tab.
    staleTime: Infinity,
    retry: false,
  });

  // The state the export actually covers. `undefined` when the caller gave
  // none: the footer then prints no counts rather than zeroes.
  const countedState: EditorStateMap | undefined =
    effectiveMode === "snippet" && vmId && snippetAssignment
      ? { [vmId]: snippetAssignment }
      : state;

  // `isFetching` as well as `isPending`: TanStack keeps `status: "error"`
  // while a refetch is in flight, so Retry would otherwise leave the same red
  // message and a live button on screen — and the reader clicks it again,
  // queueing work behind the API's suspending `Semaphore(2)`.
  const busy = query.isPending || query.isFetching;

  return (
    <ExportPanel
      bundle={busy ? undefined : query.data}
      status={busy ? "pending" : query.isError ? "error" : "ready"}
      errorMessage={query.error instanceof ExportFetchError ? query.error.message : undefined}
      versionSeq={versionSeq}
      versionLabel={versionLabel}
      isCurrent={isCurrent}
      mode={effectiveMode}
      onModeChange={setMode}
      snippetAvailable={snippetAvailable}
      stateError={stateError}
      counts={exportCounts(countedState)}
      onRetry={() => void query.refetch()}
      projectSlug={projectSlug}
    />
  );
}
