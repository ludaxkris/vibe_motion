"use client";

/**
 * The project's version list, and the one fetch that turns a freshly opened
 * project into an editable draft: `stateAt(currentVersionId)` into the store.
 *
 * Before Phase 6 the shell opened every project on an empty
 * `currentVersionState`, so the first Save of an already-animated project
 * would have posted a diff that re-set everything in it. The load here is what
 * makes `draftState` the *page as it was last saved*, and it runs exactly once
 * per project open — the store's `currentVersionId` (null after the shell's
 * `reset()`) is the flag, so a remount cannot repeat it.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { Project, Version } from "@/lib/api-client";
import { selectUnsaved, useEditorStore, type EditorState } from "@/lib/store";
import { fetchVersionState } from "@/lib/versions/api";
import { useVersions, versionStateKey } from "@/lib/versions/queries";

export type ProjectVersions = {
  /** Ascending by `seq`; empty until the list lands. */
  versions: readonly Version[];
  /** The version `draftState` was forked from. */
  currentVersion: Version | undefined;
  /** `v<seq>` of {@link currentVersion}; undefined before the list lands. */
  currentVersionLabel: string | undefined;
  /** `v<seq + 1>`: the version the next Save would create. */
  nextVersionLabel: string;
};

/** The one place `v<seq>` is spelled, so the chip, the guard and the dialogs agree. */
function label(seq: number): string {
  return `v${seq}`;
}

/**
 * Whether the open load may still write into this store: it has no version of
 * its own yet, and no work in it that the load would take with it.
 */
function untouched(state: EditorState): boolean {
  return state.currentVersionId === null && !selectUnsaved(state);
}

export function useProjectVersions(
  projectId: string,
  /** The shell's loaded project, or undefined while its own query is pending. */
  project: Project | undefined,
): ProjectVersions {
  const queryClient = useQueryClient();
  const { data } = useVersions(projectId, project !== undefined);
  const loadVersion = useEditorStore((state) => state.loadVersion);
  // Not a subscription: the *store's* current version is read where it is
  // needed. Subscribing would re-run the open load's effect on every save.
  const storeVersionId = useEditorStore((state) => state.currentVersionId);

  /** The `<projectId>:<versionId>` a load is in flight or done for. */
  const loading = useRef<string | null>(null);
  const listVersionId = data?.currentVersionId;

  useEffect(() => {
    if (listVersionId === undefined) return;
    const token = `${projectId}:${listVersionId}`;
    if (loading.current === token) return;
    // A store that already knows its current version has been loaded — by the
    // open load, a save, or a restore — and must not be loaded over. Nor may a
    // draft that already has unsaved work in it: `loadVersion` replaces
    // `draftState` wholesale, so this is the only thing standing between a
    // slow `stateAt()` and an edit the user has already made.
    if (!untouched(useEditorStore.getState())) return;
    loading.current = token;

    void (async () => {
      try {
        const state = await queryClient.fetchQuery({
          queryKey: versionStateKey(projectId, listVersionId),
          queryFn: () => fetchVersionState(projectId, listVersionId),
          // A version's state is immutable: every version stores a diff from
          // its parent and none of them is ever rewritten (CLAUDE.md rule 9).
          staleTime: Infinity,
        });
        // Re-checked, because the answer arrived over the network and the user
        // owned the draft the whole time it was in flight.
        if (!untouched(useEditorStore.getState())) return;
        loadVersion(listVersionId, state);
      } catch {
        // No error state and no retry yet: the editor stays on its empty draft
        // and Save stays inert, because `useSaveFlow` refuses a save that has
        // no parent version to fork from (deferred: DT logged in the report).
        loading.current = null;
      }
    })();
  }, [projectId, listVersionId, queryClient, loadVersion]);

  const versions = data?.versions ?? [];
  // The store's id, not the list's: `markSaved` moves it the instant the 201
  // lands, while the list is merely invalidated and refetches a beat later.
  const currentVersion =
    versions.find((version) => version.id === storeVersionId) ??
    versions.find((version) => version.id === listVersionId);

  return {
    versions,
    currentVersion,
    currentVersionLabel: currentVersion ? label(currentVersion.seq) : undefined,
    nextVersionLabel: label(versions.reduce((max, v) => Math.max(max, v.seq), 0) + 1),
  };
}
