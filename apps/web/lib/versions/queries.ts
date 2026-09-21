"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateVersionRequest } from "@/lib/api-client";
import { fetchVersionState, fetchVersions, restoreVersion, saveVersion, type WriteOutcome } from "./api";

export const versionsKey = (projectId: string) => ["project", projectId, "versions"] as const;
export const versionStateKey = (projectId: string, versionId: string) =>
  ["project", projectId, "versions", versionId, "state"] as const;

/** What `GET /projects/{id}/versions` answers, as the cache holds it. */
type VersionList = Awaited<ReturnType<typeof fetchVersions>>;

export function useVersions(projectId: string, enabled = true) {
  return useQuery({ queryKey: versionsKey(projectId), queryFn: () => fetchVersions(projectId), enabled, retry: false });
}

/**
 * One version's materialised state, under the same key `useVersionHistory`
 * fills when a row is viewed — so opening Export on a version you were just
 * looking at costs no request at all.
 *
 * `versionId` is null when the caller has the state from somewhere better (the
 * store holds the *current* version's, which is what the editor is forked
 * from), and the query is simply disabled then.
 *
 * A saved version is immutable and so is its state (CLAUDE.md rule 9), hence
 * `staleTime: Infinity`: nothing can make this answer stale within a session.
 */
export function useVersionState(projectId: string, versionId: string | null) {
  return useQuery({
    // Never keyed on "": a disabled query still needs a key, and one that
    // could collide with a real version's is worse than an unreachable one.
    queryKey: versionStateKey(projectId, versionId ?? "none"),
    queryFn: () => fetchVersionState(projectId, versionId ?? ""),
    enabled: versionId !== null,
    staleTime: Infinity,
    retry: false,
  });
}

function useRefreshOn(projectId: string) {
  const queryClient = useQueryClient();
  return async (outcome: WriteOutcome) => {
    if (outcome.kind !== "saved" && outcome.kind !== "stale") return;
    if (outcome.kind === "saved") {
      // Not an optimistic guess: the 201 *is* the version (id, seq, label,
      // diff, createdAt), so this is the list one beat before the refetch says
      // the same thing. Everything derived from the list needs it that early —
      // the version chip, and "Save as v<n>", which named the version that had
      // just been written if the user saved twice quickly.
      const written = outcome.version;
      queryClient.setQueryData<VersionList>(versionsKey(projectId), (previous) => {
        if (!previous || previous.versions.some((version) => version.id === written.id)) {
          return previous;
        }
        // Appended, not sorted: the list is ascending by `seq` and this is the
        // newest version there is.
        return { currentVersionId: written.id, versions: [...previous.versions, written] };
      });
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: versionsKey(projectId), exact: true }),
      queryClient.invalidateQueries({ queryKey: ["project", projectId], exact: true }),
    ]);
  };
}

export function useSaveVersion(projectId: string) {
  const refresh = useRefreshOn(projectId);
  return useMutation({ mutationFn: (body: CreateVersionRequest) => saveVersion(projectId, body), onSuccess: refresh });
}

export function useRestoreVersion(projectId: string) {
  const refresh = useRefreshOn(projectId);
  return useMutation({
    mutationFn: ({ versionId, label }: { versionId: string; label?: string }) => restoreVersion(projectId, versionId, label),
    onSuccess: refresh,
  });
}
