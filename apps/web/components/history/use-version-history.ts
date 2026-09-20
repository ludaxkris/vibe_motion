"use client";

/**
 * The three things the History tab and the viewing overlay can do to a
 * version: put it on screen read-only (`view`), come back to the current one
 * (`back`), and reproduce it as a new version (`restore`).
 *
 * Everything it composes already exists — `useVersions`, `fetchVersionState`,
 * `useRestoreVersion`, the store's `enterViewing` / `exitViewing` /
 * `loadVersion` — so this hook is the decisions: which fetch, in which order,
 * and what each outcome means on screen.
 *
 * Mounted **once**, by the editor shell, and handed to both consumers: the
 * History tab's rows and the preview's banner offer the same Restore, so
 * `restoring` has to be one flag rather than two hooks disagreeing about
 * whether a write is in flight (a second POST would create a second version).
 *
 * Restore is the one thing besides Save allowed to create a version
 * (CLAUDE.md rule 9), and only ever on a click: nothing here writes on its own.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { BUSY_MESSAGE, MAX_RETRY_SECONDS } from "@/components/editor/use-save-flow";
import { useToast } from "@/components/ui/toast";
import type { Version } from "@/lib/api-client";
import { selectUnsaved, useEditorStore } from "@/lib/store";
import { fetchVersionState, type WriteOutcome } from "@/lib/versions/api";
import { useRestoreVersion, useVersions, versionStateKey } from "@/lib/versions/queries";

/** The tab's inline error when `stateAt()` refuses; the mode is left alone. */
export const VIEW_FAILED = "Could not load that version.";

/** The list's own failure — `useVersions`, not a version's state. */
export const HISTORY_LOAD_FAILED = "Could not load version history.";

/** A restore that wrote a version this tab then could not show. */
export const RESTORED_NOT_LOADED =
  "Restored, but the new version could not be loaded. Reload the page.";

/** When the mutation's own machinery throws rather than answering. */
const RESTORE_FAILED = "Could not restore this version";

/** Stable identity, so a consumer may depend on `versions` not changing. */
const NO_VERSIONS: readonly Version[] = Object.freeze([]);

export type VersionHistory = {
  /** Ascending by `seq`; empty until the list lands. */
  versions: readonly Version[];
  /** The list has neither landed nor failed yet. */
  pending: boolean;
  /** The list could not be loaded at all; {@link retry} is the way out. */
  listError: boolean;
  /** Ask for the list again. */
  retry: () => void;
  /** The version `draftState` forked from, or null when the open load failed. */
  currentVersionId: string | null;
  /** The version on screen read-only, or null. */
  viewingVersionId: string | null;
  /** `mode === "viewing"`. */
  viewing: boolean;
  /** "v3" — the version being viewed, or undefined when none is. */
  viewingLabel: string | undefined;
  /** "v5" — the current version, as the shell's chip names it. */
  currentLabel: string | undefined;
  /** "v6" — the version a Save or a Restore would create. */
  nextLabel: string;
  /** A view or a restore that failed, for the tab's inline message. */
  error: string | null;
  /** A restore is in flight: Restore is disabled in the row and the banner. */
  restoring: boolean;
  /** Show a version read-only. Never rejects; failures come back as {@link error}. */
  view: (versionId: string) => Promise<void>;
  /** Leave viewing, back to the current version. */
  back: () => void;
  /** Create a new version reproducing this one. Never rejects. */
  restore: (versionId: string) => Promise<void>;
};

export type VersionHistoryOptions = {
  /** "v5" — from `useProjectVersions`, so the chip and the banner agree. */
  currentVersionLabel?: string;
  /** "v6" — the version the next write would create. */
  nextVersionLabel: string;
  /** False while the project itself is still loading (mirrors `useVersions`). */
  enabled?: boolean;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function useVersionHistory(
  projectId: string,
  { currentVersionLabel, nextVersionLabel, enabled = true }: VersionHistoryOptions,
): VersionHistory {
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch } = useVersions(projectId, enabled);
  const restoreVersion = useRestoreVersion(projectId);
  const { toast } = useToast();

  const enterViewing = useEditorStore((state) => state.enterViewing);
  const exitViewing = useEditorStore((state) => state.exitViewing);
  const loadVersion = useEditorStore((state) => state.loadVersion);
  // Subscribed rather than read on demand: the row's highlight, the overlay
  // and the read-only note all re-render off these.
  const storeVersionId = useEditorStore((state) => state.currentVersionId);
  const viewingVersionId = useEditorStore((state) => state.viewingVersionId);
  const viewing = useEditorStore((state) => state.mode === "viewing");

  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  /**
   * The in-flight guard, as a ref rather than `restoring`: the row's Restore
   * and the banner's are only disabled on the *next* render, so two clicks in
   * one tick would both read `restoring === false` — and write two versions
   * (CLAUDE.md rule 9). Same shape as the Save flow's `running`.
   */
  const running = useRef(false);

  const versions = data?.versions ?? NO_VERSIONS;
  const listVersionId = data?.currentVersionId ?? null;
  // The store's id first, like the chip: `markSaved` and `loadVersion` move it
  // the instant a write lands, while the list is merely invalidated.
  const currentVersionId = storeVersionId ?? listVersionId;

  const view = useCallback(
    async (versionId: string): Promise<void> => {
      const before = useEditorStore.getState();
      // Only reachable through the History tab, which the unsaved guard stands
      // in front of — so a dirty draft here is a bug, and `enterViewing`
      // throws on one. Refuse rather than throw.
      if (selectUnsaved(before)) return;

      if (versionId === (before.currentVersionId ?? listVersionId)) {
        // The current version's row is where "back" lives: it is already what
        // the editor would return to.
        if (before.mode === "viewing") exitViewing();
        return;
      }

      setError(null);
      try {
        const state = await queryClient.fetchQuery({
          queryKey: versionStateKey(projectId, versionId),
          queryFn: () => fetchVersionState(projectId, versionId),
          // A version's state is immutable: every version is a diff from its
          // parent and none of them is ever rewritten (CLAUDE.md rule 9).
          staleTime: Infinity,
        });

        // Re-read: the answer came over the network, and the draft was the
        // user's the whole time it was in flight.
        const now = useEditorStore.getState();
        if (now.mode === "viewing") {
          // Another version is on screen; leaving first keeps `enterViewing`
          // reading from the real current version rather than from a viewer buffer.
          exitViewing();
        } else if (selectUnsaved(now)) {
          // Edited mid-flight: `enterViewing` would throw, and the edit wins.
          return;
        }
        enterViewing(versionId, state);
      } catch {
        setError(VIEW_FAILED);
      }
    },
    [projectId, listVersionId, queryClient, enterViewing, exitViewing],
  );

  const back = useCallback(() => {
    setError(null);
    // Guarded: `exitViewing` replaces `draftState` wholesale, which outside
    // viewing would mean discarding whatever is in it.
    if (useEditorStore.getState().mode !== "viewing") return;
    exitViewing();
  }, [exitViewing]);

  /** The POST, with the single `busy` retry the Save flow uses. */
  const post = useCallback(
    async (versionId: string): Promise<WriteOutcome> => {
      // No label: the service writes "Restored v3" itself
      // (`apps/api/.../VersionService.kt`), and it knows the seq it restored.
      const first = await restoreVersion.mutateAsync({ versionId });
      if (first.kind !== "busy") return first;
      await wait(Math.min(first.retryAfterSeconds, MAX_RETRY_SECONDS) * 1000);
      return restoreVersion.mutateAsync({ versionId });
    },
    [restoreVersion],
  );

  const restore = useCallback(
    async (versionId: string): Promise<void> => {
      if (running.current) return;
      const target = versions.find((version) => version.id === versionId);
      running.current = true;
      setError(null);
      setRestoring(true);
      try {
        const outcome = await post(versionId);
        switch (outcome.kind) {
          case "saved": {
            const created = outcome.version;
            try {
              const state = await fetchVersionState(projectId, created.id);
              // Leaves viewing as it lands: the restored version *is* the
              // current one now, so there is nothing left to go back to.
              loadVersion(created.id, state);
              toast(
                target === undefined
                  ? `Restored as v${created.seq}`
                  : `Restored v${target.seq} as v${created.seq}`,
              );
            } catch {
              // The version exists — the list refetch will show it — but this
              // tab could not fork the draft from it, which must not read as
              // "nothing happened".
              setError(RESTORED_NOT_LOADED);
            }
            return;
          }
          case "busy":
            setError(BUSY_MESSAGE);
            return;
          case "stale":
            // Unreachable: restore sends no parent version, so there is
            // nothing for the service to find stale. Named so a future
            // outcome cannot fall through the `default` in silence.
            setError(RESTORE_FAILED);
            return;
          default:
            setError(outcome.message);
            return;
        }
      } catch (cause) {
        setError(messageOf(cause, RESTORE_FAILED));
      } finally {
        running.current = false;
        setRestoring(false);
      }
    },
    [projectId, versions, post, loadVersion, toast],
  );

  const retry = useCallback(() => {
    setError(null);
    void refetch();
  }, [refetch]);

  const viewed = versions.find((version) => version.id === viewingVersionId);

  return {
    versions,
    pending: isPending,
    listError: isError,
    retry,
    currentVersionId,
    viewingVersionId,
    viewing,
    viewingLabel: viewed ? `v${viewed.seq}` : undefined,
    currentLabel: currentVersionLabel,
    nextLabel: nextVersionLabel,
    error,
    restoring,
    view,
    back,
    restore,
  };
}
