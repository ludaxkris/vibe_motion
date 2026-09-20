/**
 * Wires `lib/versions/transitions.ts`'s pure transitions into the editor
 * store: each writer here reads the current slice from `get()`, applies the
 * matching transition, and `set`s the result. Spread into `createEditorState`
 * (see `lib/store/index.ts`).
 *
 * `loadVersion`, `enterViewing`, `exitViewing` and `rebaseDraft` replace
 * `draftState` wholesale, so each one sends the Control Panel through the same
 * `REVERT` transition `revertDraft` uses, so a selected element lands on
 * `tuning` or `selected` according to the *new* draft. The first three also
 * close an open element-switch guard — they take the draft away, so its
 * question is moot — while `rebaseDraft` keeps it, for the reason below.
 * `markSaved` touches neither: it only moves
 * `currentVersionState`/`currentVersionId`.
 */
import type { EditorStateMap, Version } from "@/lib/api-client";
import {
  enterViewing as enterViewingSlice,
  exitViewing as exitViewingSlice,
  loadVersion as loadVersionSlice,
  markSaved as markSavedSlice,
  rebaseDraft as rebaseDraftSlice,
} from "@/lib/versions/transitions";

import { transition, type PanelState } from "./panel-machine";
import type { EditorState } from "./index";

/** `data-vm-id` of the element selected in `panel`, or null. Mirrors `selectSelectedVmId`. */
function selectedVmId(panel: PanelState): string | null {
  return "vmId" in panel ? panel.vmId : null;
}

/**
 * Apply a slice that replaces `draftState` wholesale: merge it in, run the
 * panel through `REVERT` against the *new* draft so the selected element's
 * `tuning`/`selected` status follows it, and close any open element-switch
 * guard — unless `keepGuard`, which is for the one replacement that takes
 * nothing away (a rebase, see below).
 */
function applyDraftReplacement(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  slice: Pick<EditorState, "draftState" | "currentVersionState" | "mode" | "currentVersionId" | "viewingVersionId">,
  keepGuard = false,
): void {
  const state = get();
  const vmId = selectedVmId(state.panel);
  const panel = transition(state.panel, {
    type: "REVERT",
    draftAnimationId: vmId === null ? undefined : slice.draftState[vmId]?.animationId,
  });

  if (keepGuard) {
    set({ ...slice, panel });
    return;
  }
  set({ ...slice, panel, pendingSelectVmId: null, guardedVmId: null });
}

export function createVersionActions(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
) {
  return {
    loadVersion: (versionId: string, versionState: EditorStateMap) =>
      applyDraftReplacement(set, get, loadVersionSlice(get(), versionId, versionState)),

    // `posted` is the draft the request carried, for the case where the draft
    // has moved since (see `markSaved` in `lib/versions/transitions.ts`).
    markSaved: (version: Version, posted?: EditorStateMap) =>
      set(markSavedSlice(get(), version, posted)),

    enterViewing: (versionId: string, versionState: EditorStateMap) =>
      applyDraftReplacement(set, get, enterViewingSlice(get(), versionId, versionState)),

    exitViewing: () => applyDraftReplacement(set, get, exitViewingSlice(get())),

    // The only draft replacement that keeps an open element-switch guard: a
    // rebase replays the draft's own diff, so the work the guard is asking
    // about is still there — and the guard's Save is the very thing that asked
    // for this rebase (the 409's "Apply my changes on top"). Closing it here
    // left `resolveGuard("saved")` with nothing pending, and the selection
    // never moved to the element the user had clicked.
    rebaseDraft: (newCurrentId: string, newCurrentState: EditorStateMap) =>
      applyDraftReplacement(set, get, rebaseDraftSlice(get(), newCurrentId, newCurrentState), true),
  };
}
