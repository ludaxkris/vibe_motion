"use client";

/**
 * The Save flow: the only thing in the editor allowed to create a version
 * (CLAUDE.md rule 9). Everything it needs already exists — `computeDiff`,
 * `summariseDiff`, `useSaveVersion`, the two dialogs, the store's
 * `markSaved` / `loadVersion` / `rebaseDraft` — so this is the composition:
 * which dialog is open, what the round trip's outcome means, and one promise
 * that tells the caller whether a version was actually written.
 *
 * That promise is the contract the unsaved guards need (`docs/plans/`
 * `phase-6-version-history-plan.md`, Task 7 results): they await `requestSave()`
 * and only let the action they were guarding through when it resolves. It
 * resolves on a 201 — or when a rebase shows the change is already saved — and
 * rejects on every exit that wrote nothing, including Cancel, so a guard can
 * never mistake an abandoned save for a save.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useToast } from "@/components/ui/toast";
import type { CreateVersionRequest, Version } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntryAt } from "@/lib/catalog";
import { MAX_LABEL_LENGTH, summariseDiff, type DiffRow } from "@/lib/diff-summary";
import { selectUnsaved, useEditorStore, type EditorState } from "@/lib/store";
import { fetchVersionState, type WriteOutcome } from "@/lib/versions/api";
import { computeDiff } from "@/lib/versions/diff";
// Shared with Restore, the other write on this screen: one `503` story, one cap.
import { BUSY_MESSAGE, MAX_RETRY_SECONDS } from "@/lib/versions/messages";
import { useSaveVersion } from "@/lib/versions/queries";

import type { SaveFlowDialogsProps } from "./save-flow-dialogs";

/**
 * Every exit that wrote nothing rejects with this, and every caller swallows
 * it: "the user said no" is not an error to report, it is the answer.
 */
const CANCELLED = "save cancelled";

/** When the API could not even be asked — `fetchVersionState` throws rather than answering. */
const LOAD_FAILED = "Could not load this version";

/**
 * Save with no parent version to fork from: the project's open load never
 * landed (`useProjectVersions`). Said out loud, because the top bar's Save is
 * enabled the moment the draft is dirty and refusing in silence made it a
 * button that did nothing at all.
 */
export const CANNOT_SAVE_YET =
  "Can't save yet — this project's current version didn't load. Retry, or reload the page.";

type Settle = { resolve: () => void; reject: (reason: Error) => void };

type Stage =
  | { kind: "closed" }
  | { kind: "save"; label: string; changes: readonly DiffRow[]; error?: string; saving: boolean }
  | { kind: "conflict"; theirs: Version; error?: string; busy: boolean };

export type SaveFlow = {
  /**
   * Open the Save dialog and resolve once a version exists. Rejects — with an
   * error callers are expected to swallow — when the dialog is cancelled, when
   * the 409 was answered with anything but a rebase, and when there was
   * nothing to save in the first place. Called again while a dialog is open,
   * it hands back the same pending promise rather than opening a second one.
   */
  requestSave: () => Promise<void>;
  /** Spread onto `<SaveFlowDialogs />`. */
  dialogs: SaveFlowDialogsProps;
};

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The dialog's rows and prefilled label, off the store as it stands right now. */
function summarise(state: EditorState) {
  return summariseDiff(state.currentVersionState, state.draftState, getCatalogEntryAt);
}

export type SaveFlowOptions = {
  /** "v5" — the version the draft forked from, shown as "from v5". */
  currentVersionLabel?: string;
  /** "v6" — the version this save would create. */
  nextVersionLabel: string;
  /**
   * `useProjectVersions`' retry. Called when a save is asked for and there is
   * no current version to fork from, so the one action that can unstick the
   * screen happens on the click that discovered the problem.
   */
  retryLoad?: () => void;
};

export function useSaveFlow(
  projectId: string,
  { currentVersionLabel, nextVersionLabel, retryLoad }: SaveFlowOptions,
): SaveFlow {
  const [stage, setStage] = useState<Stage>({ kind: "closed" });
  /** The resolvers of the promise `requestSave` handed out, while one is outstanding. */
  const settle = useRef<Settle | null>(null);
  const pending = useRef<Promise<void> | null>(null);
  /** An await is in flight; a second click on the same button must not start another. */
  const running = useRef(false);

  const { toast } = useToast();
  const save = useSaveVersion(projectId);
  const markSaved = useEditorStore((state) => state.markSaved);
  const loadVersion = useEditorStore((state) => state.loadVersion);
  const rebaseDraft = useEditorStore((state) => state.rebaseDraft);

  /**
   * The project this hook is on *now*: the shell `reset()`s on a project
   * change rather than remounting, so an answer for the project the reader
   * left must not land in the one they are on (same guard as
   * `useProjectVersions`' `active` and `useVersionHistory`'s `activeProject`).
   */
  const activeProject = useRef(projectId);
  useEffect(() => {
    activeProject.current = projectId;
  }, [projectId]);
  /** False once this hook is gone; a busy retry's timer can outlive it. */
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);

  /** Close every dialog and settle the outstanding promise, exactly once. */
  const finish = useCallback((written: boolean) => {
    const outstanding = settle.current;
    settle.current = null;
    pending.current = null;
    setStage({ kind: "closed" });
    if (!outstanding) return;
    if (written) outstanding.resolve();
    else outstanding.reject(new Error(CANCELLED));
  }, []);

  const requestSave = useCallback((): Promise<void> => {
    // One flow at a time: the top bar and a guard can both ask, and they are
    // asking about the same draft.
    if (pending.current) return pending.current;

    const state = useEditorStore.getState();
    // Nothing to ask about: a clean draft would post an empty diff, and
    // viewing is read-only (`markSaved` throws there). Neither is worth a
    // word — the Save button is disabled in both.
    if (state.mode === "viewing" || !selectUnsaved(state)) {
      return Promise.reject(new Error(CANCELLED));
    }

    // Dirty, but with nothing to fork from: the project's open load failed, so
    // this draft is sitting on top of a state the editor never read. Say so,
    // and ask for that load again on the way out.
    if (state.currentVersionId === null) {
      toast(CANNOT_SAVE_YET);
      retryLoad?.();
      return Promise.reject(new Error(CANCELLED));
    }

    const { rows, label } = summarise(state);
    setStage({ kind: "save", label, changes: rows, saving: false });
    const promise = new Promise<void>((resolve, reject) => {
      settle.current = { resolve, reject };
    });
    pending.current = promise;
    return promise;
  }, [toast, retryLoad]);

  /** The POST, with the single `busy` retry. A second `busy` comes back as `busy`. */
  async function post(body: CreateVersionRequest): Promise<WriteOutcome> {
    const first = await save.mutateAsync(body);
    if (first.kind !== "busy") return first;
    await wait(Math.min(first.retryAfterSeconds, MAX_RETRY_SECONDS) * 1000);
    return save.mutateAsync(body);
  }

  const failSave = (message: string) =>
    setStage((current) =>
      current.kind === "save" ? { ...current, saving: false, error: message } : current,
    );

  /** Confirm: write the draft as it is at this moment. */
  async function confirmSave(label: string): Promise<void> {
    if (running.current) return;
    const state = useEditorStore.getState();
    const parentVersionId = state.currentVersionId;
    // Unreachable: `requestSave` refuses to open without one.
    if (parentVersionId === null) return;
    // Held, not re-read: only the draft that was actually posted may be
    // promoted to "saved" afterwards.
    const posted = state.draftState;

    running.current = true;
    setStage((current) =>
      current.kind === "save" ? { ...current, saving: true, error: undefined } : current,
    );
    try {
      const outcome = await post({
        parentVersionId,
        catalogVersion: CURRENT_CATALOG_VERSION,
        // Trimmed and capped rather than sent verbatim: the field allows
        // typing past the visual cap is not possible (`maxLength` on the
        // `<Input>`), but a prefilled label already at the limit plus a
        // paste could still exceed it, and a whitespace-only edit should
        // read as "no label" the way the server treats an empty one.
        label: label.trim().slice(0, MAX_LABEL_LENGTH) || undefined,
        diff: computeDiff(state.currentVersionState, posted),
      });

      switch (outcome.kind) {
        case "saved":
          // Against what was posted, not against the draft as it stands: an
          // edit that landed while the 201 was in flight is not in this
          // version, and must stay unsaved work rather than either being
          // called saved or leaving the store behind a version that exists.
          markSaved(outcome.version, posted);
          toast(`Saved v${outcome.version.seq}`);
          finish(true);
          return;
        case "stale":
          // The draft is untouched and the promise still outstanding: the
          // conflict dialog is the rest of this same question.
          setStage({ kind: "conflict", theirs: outcome.currentVersion, busy: false });
          return;
        case "busy":
          failSave(BUSY_MESSAGE);
          return;
        default:
          failSave(outcome.message);
          return;
      }
    } catch (cause) {
      // `saveVersion` answers with an outcome rather than throwing, so this is
      // the mutation's own machinery failing. Still the dialog's news to break.
      failSave(messageOf(cause, "Could not save this version"));
    } finally {
      running.current = false;
    }
  }

  /** The conflict dialog, while one of its three answers is being carried out. */
  const conflictBusy = (busy: boolean) =>
    setStage((current) =>
      current.kind === "conflict" ? { ...current, busy, error: undefined } : current,
    );

  const failConflict = (cause: unknown) =>
    setStage((current) =>
      current.kind === "conflict"
        ? { ...current, busy: false, error: messageOf(cause, LOAD_FAILED) }
        : current,
    );

  /** Apply my changes on top: replay my diff onto theirs, then ask again. */
  async function rebase(theirs: Version): Promise<void> {
    if (running.current) return;
    running.current = true;
    conflictBusy(true);
    try {
      const theirState = await fetchVersionState(projectId, theirs.id);
      if (activeProject.current !== projectId) {
        // The reader moved to another project while `theirs` was in flight.
        // Rebasing it onto *this* draft would mix the two projects' states,
        // and it is not this project's conflict to ask about any more — but
        // the promise `requestSave` handed out must still settle rather than
        // dangle for a caller (a guard) that is still awaiting it.
        finish(false);
        return;
      }
      rebaseDraft(theirs.id, theirState);

      const rebased = useEditorStore.getState();
      if (!selectUnsaved(rebased)) {
        // Their save already contains my change, so there is no diff left to
        // write — and an empty diff is not a version (CLAUDE.md rule 9).
        if (mounted.current) toast(`Already saved in v${theirs.seq}`);
        finish(true);
        return;
      }

      // Never an automatic retry: the write the user confirmed is not the
      // write this would make, so they confirm the new one.
      const { rows, label } = summarise(rebased);
      setStage({ kind: "save", label, changes: rows, saving: false });
    } catch (cause) {
      failConflict(cause);
    } finally {
      running.current = false;
    }
  }

  /** Discard my changes: go to theirs, and report that nothing was saved. */
  async function discard(theirs: Version): Promise<void> {
    if (running.current) return;
    running.current = true;
    conflictBusy(true);
    try {
      const theirState = await fetchVersionState(projectId, theirs.id);
      if (activeProject.current !== projectId) {
        // Same guard as `rebase`: theirs belongs to the project the reader
        // has left, and must never land in the one they are on now. Nothing
        // was saved either way, so the promise still rejects.
        finish(false);
        return;
      }
      loadVersion(theirs.id, theirState);
      if (mounted.current) toast(`Loaded v${theirs.seq}`);
      finish(false);
    } catch (cause) {
      failConflict(cause);
    } finally {
      running.current = false;
    }
  }

  const dialogs: SaveFlowDialogsProps = {
    save:
      stage.kind === "save"
        ? {
            nextVersionLabel,
            fromVersionLabel: currentVersionLabel,
            label: stage.label,
            onLabelChange: (label) =>
              setStage((current) => (current.kind === "save" ? { ...current, label } : current)),
            changes: stage.changes,
            error: stage.error,
            saving: stage.saving,
            saveDisabled: false,
            onCancel: () => {
              if (running.current) return;
              finish(false);
            },
            onSave: () => void confirmSave(stage.label),
          }
        : undefined,
    conflict:
      stage.kind === "conflict"
        ? {
            theirs: stage.theirs,
            error: stage.error,
            busy: stage.busy,
            onRebase: () => void rebase(stage.theirs),
            onDiscard: () => void discard(stage.theirs),
            onCancel: () => {
              if (running.current) return;
              finish(false);
            },
          }
        : undefined,
  };

  return { requestSave, dialogs };
}
