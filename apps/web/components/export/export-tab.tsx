"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { apiClient, type EditorStateMap, type ExportBundle } from "@/lib/api-client";

import { type ExportMode, ExportPanel } from "./export-panel";
import { exportStats } from "./export-stats";

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

async function fetchExport(
  projectId: string,
  query: { versionId: string; mode: ExportMode; vmId?: string },
): Promise<ExportBundle> {
  const { data, error, response } = await apiClient.GET("/projects/{projectId}/export", {
    params: { path: { projectId }, query },
  });
  if (error) throw new ExportFetchError(response.status, error.message);
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
  /** The project's name; only the download file name ever sees it. */
  projectSlug?: string;
};

/**
 * The Export tab, wired to `GET /projects/{projectId}/export`.
 *
 * Not mounted anywhere yet: Track C puts it in the panel's Export
 * `TabsContent` once PR #21 and PR #22 are on `main`.
 */
export function ExportTab({
  projectId,
  versionId,
  versionSeq,
  versionLabel,
  isCurrent,
  selectedVmId,
  state,
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

  const statsState: EditorStateMap | undefined =
    effectiveMode === "snippet" && vmId && snippetAssignment
      ? { [vmId]: snippetAssignment }
      : state;

  return (
    <ExportPanel
      bundle={query.data}
      status={query.isPending ? "pending" : query.isError ? "error" : "ready"}
      errorMessage={query.error instanceof ExportFetchError ? query.error.message : undefined}
      versionSeq={versionSeq}
      versionLabel={versionLabel}
      isCurrent={isCurrent}
      mode={effectiveMode}
      onModeChange={setMode}
      snippetAvailable={snippetAvailable}
      stats={query.data ? exportStats(statsState) : undefined}
      onRetry={() => void query.refetch()}
      projectSlug={projectSlug}
    />
  );
}
