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
 * A draft edited before that fetch lands is *rebased* onto it rather than
 * overwritten or abandoned: the edit was made over an empty base, so the
 * server's state with the edit replayed on top loses nothing — and the draft
 * comes out of it with the parent version Save needs.
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
 * Whether the open load still has anything to do here. A store that already
 * knows its current version has been loaded — by the open load, a save, or a
 * restore — and must never be loaded over. That one fact is also what makes
 * the load idempotent, which is why the in-flight token below does not have to
 * be: a remount, a second list answer or a retry all find the version and stop.
 */
function needsCurrentVersion(state: EditorState): boolean {
  return state.currentVersionId === null;
}

export function useProjectVersions(
  projectId: string,
  /** The shell's loaded project, or undefined while its own query is pending. */
  project: Project | undefined,
): ProjectVersions {
  const queryClient = useQueryClient();
  const { data, refetch } = useVersions(projectId, project !== undefined);
  const loadVersion = useEditorStore((state) => state.loadVersion);
  // For the one case `loadVersion` cannot serve: a draft that was edited
  // before this load could give it a base (see `load` below).
  const rebaseDraft = useEditorStore((state) => state.rebaseDraft);
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

  /**
   * The `<projectId>:<versionId>` a load is *in flight* for, and nothing more:
   * cleared in a `finally`, so no exit can leave it standing. It used to also
   * mean "done", which made every no-op exit permanent — a dirty draft or a
   * second visit to the same project could never load again, and the Retry
   * that was supposed to unstick the screen returned here.
   * Idempotence is the store's `currentVersionId` (see `needsCurrentVersion`).
   */
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
      // Single flight: a second caller for the same version joins the first
      // rather than starting its own.
      if (loading.current === token) return;
      if (!needsCurrentVersion(useEditorStore.getState())) return;
      loading.current = token;

      try {
        const state = await queryClient.fetchQuery({
          queryKey: versionStateKey(projectId, versionId),
          queryFn: () => fetchVersionState(projectId, versionId),
          // A version's state is immutable: every version stores a diff from
          // its parent and none of them is ever rewritten (CLAUDE.md rule 9).
          staleTime: Infinity,
        });
        // Re-checked, because the answer arrived over the network: the user may
        // have navigated to another project altogether, and this state must
        // never land in the editor of a project it does not belong to.
        if (active.current !== projectId) return;
        // …and they owned the draft the whole time it was in flight, so it may
        // have gained a version of its own (a save, a restore, another load).
        const now = useEditorStore.getState();
        if (!needsCurrentVersion(now)) return;

        if (selectUnsaved(now)) {
          // Edited while this was on its way. `loadVersion` would replace
          // `draftState` wholesale and take the edit with it — but a rebase
          // here is lossless: with no current version the draft was built on
          // an empty base, so `computeDiff({}, draft)` removes nothing and the
          // result is the server's state with the user's edits on top. Bailing
          // instead is what used to leave the draft with no parent version,
          // which Save refuses (`CANNOT_SAVE_YET`) — a dead end only a reload
          // got out of, at the cost of the work.
          rebaseDraft(versionId, state);
          return;
        }
        loadVersion(versionId, state);
      } catch {
        // The banner, the toast and `useSaveFlow`'s refusal are the three
        // things that keep this from being a silent empty draft.
        if (active.current !== projectId) return;
        setFailure({ projectId, message: VERSION_LOAD_FAILED });
        toast(VERSION_LOAD_FAILED);
      } finally {
        // Only our own flight: a later `load` for another version of this
        // project owns the slot by now, and is still in the air.
        if (loading.current === token) loading.current = null;
      }
    },
    [projectId, queryClient, loadVersion, rebaseDraft, toast],
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
  // (The write puts what it created into that list itself — see
  // `useRefreshOn` in `lib/versions/queries.ts` — so this resolves straight
  // away rather than naming the version before it.)
  const currentVersion =
    versions.find((version) => version.id === storeVersionId) ??
    versions.find((version) => version.id === listVersionId);

  return {
    versions,
    currentVersion,
    currentVersionLabel: currentVersion ? label(currentVersion.seq) : undefined,
    // The high-water mark of both, never the list alone: the version the draft
    // was forked from is the one the next save's parent will be, and "Save as
    // v1" while v2 is being created is a lie about what the button does.
    nextVersionLabel: label(
      versions.reduce((max, v) => Math.max(max, v.seq), currentVersion?.seq ?? 0) + 1,
    ),
    loadError,
    retryLoad,
  };
}
