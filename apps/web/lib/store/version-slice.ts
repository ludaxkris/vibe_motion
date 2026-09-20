/**
 * Wires `lib/versions/transitions.ts`'s pure transitions into the editor
 * store: each writer here reads the current slice from `get()`, applies the
 * matching transition, and `set`s the result. Spread into `createEditorState`
 * (see `lib/store/index.ts`).
 *
 * `loadVersion`, `enterViewing`, `exitViewing` and `rebaseDraft` replace
 * `draftState` wholesale, so each one also closes an open element-switch
 * guard and sends the Control Panel through the same `REVERT` transition
 * `revertDraft` uses, so a selected element lands on `tuning` or `selected`
 * according to the *new* draft. `markSaved` touches neither: it only moves
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
 * Apply a slice that replaces `draftState` wholesale: merge it in, close any
 * open element-switch guard, and run the panel through `REVERT` against the
 * *new* draft so the selected element's `tuning`/`selected` status follows it.
 */
function applyDraftReplacement(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  slice: Pick<EditorState, "draftState" | "currentVersionState" | "mode" | "currentVersionId" | "viewingVersionId">,
): void {
  const state = get();
  const vmId = selectedVmId(state.panel);
  const panel = transition(state.panel, {
    type: "REVERT",
    draftAnimationId: vmId === null ? undefined : slice.draftState[vmId]?.animationId,
  });

  set({ ...slice, panel, pendingSelectVmId: null, guardedVmId: null });
}

export function createVersionActions(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
) {
  return {
    loadVersion: (versionId: string, versionState: EditorStateMap) =>
      applyDraftReplacement(set, get, loadVersionSlice(get(), versionId, versionState)),

    markSaved: (version: Version) => set(markSavedSlice(get(), version)),

    enterViewing: (versionId: string, versionState: EditorStateMap) =>
      applyDraftReplacement(set, get, enterViewingSlice(get(), versionId, versionState)),

    exitViewing: () => applyDraftReplacement(set, get, exitViewingSlice(get())),

    rebaseDraft: (newCurrentId: string, newCurrentState: EditorStateMap) =>
      applyDraftReplacement(set, get, rebaseDraftSlice(get(), newCurrentId, newCurrentState)),
  };
}
