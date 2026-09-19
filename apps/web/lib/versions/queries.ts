"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateVersionRequest } from "@/lib/api-client";
import { fetchVersions, restoreVersion, saveVersion, type WriteOutcome } from "./api";

export const versionsKey = (projectId: string) => ["project", projectId, "versions"] as const;
export const versionStateKey = (projectId: string, versionId: string) =>
  ["project", projectId, "versions", versionId, "state"] as const;

export function useVersions(projectId: string, enabled = true) {
  return useQuery({ queryKey: versionsKey(projectId), queryFn: () => fetchVersions(projectId), enabled, retry: false });
}

function useRefreshOn(projectId: string) {
  const queryClient = useQueryClient();
  return async (outcome: WriteOutcome) => {
    if (outcome.kind !== "saved" && outcome.kind !== "stale") return;
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
