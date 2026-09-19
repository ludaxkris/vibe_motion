/**
 * The writers `currentVersionState` was waiting for (see the header of
 * `lib/store/index.ts`). Pure functions over a structural slice: the store
 * factory spreads their result into `set(...)`; nothing here imports the store.
 *
 * While viewing, `draftState` holds the *viewed* version's state (the iframe
 * always shows `draftState`) and `currentVersionState` still holds the real
 * current one, so "Back to v5" needs no fetch. `selectUnsaved` is therefore
 * meaningless while `mode === "viewing"`; callers check mode first.
 */
import type { EditorStateMap, Version } from "@/lib/api-client";
import { applyDiff, computeDiff, isEmptyDiff } from "./diff";

export type VersionSlice = {
  draftState: EditorStateMap;
  currentVersionState: EditorStateMap;
  mode: "editing" | "viewing";
  currentVersionId: string | null;
  viewingVersionId: string | null;
};

export const initialVersionSlice: VersionSlice = {
  draftState: {}, currentVersionState: {}, mode: "editing", currentVersionId: null, viewingVersionId: null,
};

export function loadVersion(_slice: VersionSlice, versionId: string, state: EditorStateMap): VersionSlice {
  return { draftState: { ...state }, currentVersionState: state, mode: "editing", currentVersionId: versionId, viewingVersionId: null };
}

export function markSaved(slice: VersionSlice, version: Version): VersionSlice {
  return { ...slice, currentVersionState: { ...slice.draftState }, currentVersionId: version.id };
}

export function enterViewing(slice: VersionSlice, versionId: string, state: EditorStateMap): VersionSlice {
  if (slice.mode === "editing" && !isEmptyDiff(computeDiff(slice.currentVersionState, slice.draftState))) {
    throw new Error("enterViewing with unsaved changes: run the guard first");
  }
  return { ...slice, draftState: { ...state }, mode: "viewing", viewingVersionId: versionId };
}

export function exitViewing(slice: VersionSlice): VersionSlice {
  return { ...slice, draftState: { ...slice.currentVersionState }, mode: "editing", viewingVersionId: null };
}

export function rebaseDraft(slice: VersionSlice, newCurrentId: string, newCurrentState: EditorStateMap): VersionSlice {
  const mine = computeDiff(slice.currentVersionState, slice.draftState);
  return { draftState: applyDiff(newCurrentState, mine), currentVersionState: newCurrentState, mode: "editing", currentVersionId: newCurrentId, viewingVersionId: null };
}
