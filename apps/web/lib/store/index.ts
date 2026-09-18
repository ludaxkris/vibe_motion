/**
 * Editor store (placeholder).
 *
 * Shape follows docs/architecture.md §4: the shell keeps
 * `selectedVmId · draftState · currentVersionState · unsaved · mode` in one
 * Zustand store, which the Control Panel and the bridge client both read.
 *
 * Phase 0 defines the types and an empty store only. The real actions land with
 * the bridge (Phase 4), the Control Panel flows (Phase 5) and version history
 * (Phase 6). Live preview edits stay in `draftState` and never hit the API;
 * `currentVersionState` only changes when a version is saved, loaded or restored.
 */
import { create } from "zustand";

import type { Assignment, EditorStateMap } from "@/lib/api-client";

/**
 * `editing` — the draft is live and the user can change it.
 * `viewing` — a past version is loaded read-only (Phase 6); restoring returns to `editing`.
 */
export type EditorMode = "editing" | "viewing";

export type EditorState = {
  /** `data-vm-id` of the element selected in the preview iframe, or null when nothing is selected. */
  selectedVmId: string | null;
  /** Client-side draft: what the iframe currently shows. Never persisted until Save. */
  draftState: EditorStateMap;
  /** Materialised state of the version the draft was forked from. */
  currentVersionState: EditorStateMap;
  /** True when `draftState` differs from `currentVersionState`. */
  unsaved: boolean;
  mode: EditorMode;
};

export type EditorActions = {
  setSelectedVmId: (vmId: string | null) => void;
  setMode: (mode: EditorMode) => void;
  reset: () => void;
};

export type EditorStore = EditorState & EditorActions;

export const initialEditorState: EditorState = {
  selectedVmId: null,
  draftState: {},
  currentVersionState: {},
  unsaved: false,
  mode: "editing",
};

export const useEditorStore = create<EditorStore>((set) => ({
  ...initialEditorState,
  setSelectedVmId: (selectedVmId) => set({ selectedVmId }),
  setMode: (mode) => set({ mode }),
  reset: () => set({ ...initialEditorState }),
}));

export type { Assignment, EditorStateMap };
