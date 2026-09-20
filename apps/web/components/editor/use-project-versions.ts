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
 *
 * When it fails, the editor is left showing an empty draft over a project that
 * has animations, and `useSaveFlow` has no parent version to fork from. That
 * has to be said out loud rather than left as an inert Save button, so the
 * failure comes back as `loadError` (the shell's banner) with a `retryLoad`
 * beside it, and is announced once as a toast.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import type { Project, Version } from "@/lib/api-client";
import { selectUnsaved, useEditorStore, type EditorState } from "@/lib/store";
import { fetchVersionState } from "@/lib/versions/api";
import { useVersions, versionStateKey } from "@/lib/versions/queries";

/**
 * What the banner and the toast both say. One sentence rather than the
 * service's own message: the reader's problem is that the page they are
 * looking at is not the page they saved, which no status code explains.
 */
export const VERSION_LOAD_FAILED = "Could not load this project's saved animations.";

export type ProjectVersions = {
  /** Ascending by `seq`; empty until the list lands. */
  versions: readonly Version[];
  /** The version `draftState` was forked from. */
  currentVersion: Version | undefined;
  /** `v<seq>` of {@link currentVersion}; undefined before the list lands. */
  currentVersionLabel: string | undefined;
  /** `v<seq + 1>`: the version the next Save would create. */
  nextVersionLabel: string;
  /** Set when the open load failed, and the draft is therefore not the saved state. */
  loadError: string | null;
  /** Try the open load again — the list too, when that is what never landed. */
  retryLoad: () => void;
};

/** Stable identity, so a consumer may depend on `versions` not changing. */
const NO_VERSIONS: readonly Version[] = Object.freeze([]);

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
  const { data, refetch } = useVersions(projectId, project !== undefined);
  const loadVersion = useEditorStore((state) => state.loadVersion);
  // Subscribed, so the chip follows a save without waiting for the list to
  // refetch. The open load's effect deliberately does *not* depend on this:
  // it reads the store imperatively, so moving on from a save cannot re-run it.
  const storeVersionId = useEditorStore((state) => state.currentVersionId);
  const { toast } = useToast();

  /**
   * The failed load, tagged with the project it belongs to, so navigating to
   * another project clears it by simply not matching — rather than an effect
   * that has to remember to.
   */
  const [failure, setFailure] = useState<{ projectId: string; message: string } | null>(null);
  const loadError = failure?.projectId === projectId ? failure.message : null;

  /** The `<projectId>:<versionId>` a load is in flight or done for. */
  const loading = useRef<string | null>(null);
  /**
   * The project the screen is on *now*. The shell `reset()`s on a project
   * change rather than remounting, so an answer for the project the user has
   * left finds a store that looks untouched and would overwrite the one they
   * are on. Declared before the load effect so it is updated first.
   */
  const active = useRef(projectId);
  useEffect(() => {
    active.current = projectId;
  }, [projectId]);

  const load = useCallback(
    async (versionId: string) => {
      const token = `${projectId}:${versionId}`;
      if (loading.current === token) return;
      // A store that already knows its current version has been loaded — by
      // the open load, a save, or a restore — and must not be loaded over. Nor
      // may a draft that already has unsaved work in it: `loadVersion`
      // replaces `draftState` wholesale, so this is the only thing standing
      // between a slow `stateAt()` and an edit the user has already made.
      if (!untouched(useEditorStore.getState())) return;
      loading.current = token;

      try {
        const state = await queryClient.fetchQuery({
          queryKey: versionStateKey(projectId, versionId),
          queryFn: () => fetchVersionState(projectId, versionId),
          // A version's state is immutable: every version stores a diff from
          // its parent and none of them is ever rewritten (CLAUDE.md rule 9).
          staleTime: Infinity,
        });
        // Both re-checked, because the answer arrived over the network: the
        // user owned the draft the whole time it was in flight, and may have
        // navigated to another project altogether.
        if (active.current !== projectId) return;
        if (!untouched(useEditorStore.getState())) return;
        loadVersion(versionId, state);
      } catch {
        // The banner, the toast and `useSaveFlow`'s refusal are the three
        // things that keep this from being a silent empty draft.
        loading.current = null;
        if (active.current !== projectId) return;
        setFailure({ projectId, message: VERSION_LOAD_FAILED });
        toast(VERSION_LOAD_FAILED);
      }
    },
    [projectId, queryClient, loadVersion, toast],
  );

  const listVersionId = data?.currentVersionId;

  useEffect(() => {
    if (listVersionId === undefined) return;
    void load(listVersionId);
  }, [listVersionId, load]);

  const retryLoad = useCallback(() => {
    setFailure(null);
    // No version to ask about means the *list* is what never landed; the load
    // effect fires on its own once that answers.
    if (listVersionId === undefined) {
      void refetch();
      return;
    }
    void load(listVersionId);
  }, [listVersionId, load, refetch]);

  const versions = data?.versions ?? NO_VERSIONS;
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
    loadError,
    retryLoad,
  };
}
