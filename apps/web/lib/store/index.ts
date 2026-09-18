/**
 * Editor store.
 *
 * Shape follows docs/architecture.md §4: the shell keeps
 * `selectedVmId · draftState · currentVersionState · unsaved · mode` in one
 * Zustand store, which the Control Panel and the bridge client both read.
 *
 * The Control Panel is driven by an explicit state machine
 * (`lib/store/panel-machine.ts`, `panel` + `dispatchPanel`). `selectedVmId`
 * and `unsaved` stay real state fields — not computed selectors — so the
 * existing readers (`components/editor/editor-shell.tsx`) keep working
 * unchanged; both are recomputed inside every action that can change them.
 *
 * Live preview edits stay in `draftState` and never hit the API;
 * `currentVersionState` only changes when a version is saved, loaded or
 * restored (Phase 6). No action in this module calls the API.
 */
import { create } from "zustand";

import type { Assignment, EditorStateMap } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry } from "@/lib/catalog";
import { resolveParams } from "@/lib/runtime-css";
// `lib/catalog.ts` types entries against the OpenAPI-generated `CatalogEntry`
// (a plain `triggers: Trigger[]`), while `resolveParams` types against the
// `animation-catalog` package's own `CatalogEntry` (a non-empty tuple, since
// the catalog schema requires `minItems: 1`). Both describe the same runtime
// object — `lib/catalog.ts` already bridges this with a cast — so bridge it
// here too rather than widening either module's public type.
import type { CatalogEntry as CatalogPackageEntry } from "animation-catalog";

import {
  initialPanelState,
  transition,
  type PanelEvent,
  type PanelState,
} from "./panel-machine";

/**
 * `editing` — the draft is live and the user can change it.
 * `viewing` — a past version is loaded read-only (Phase 6); restoring returns to `editing`.
 */
export type EditorMode = "editing" | "viewing";

export type EditorState = {
  /** Control Panel state machine (idle / selected / choosing / tuning). */
  panel: PanelState;
  /** `data-vm-id` of the element selected in the preview iframe, or null when nothing is selected. Derived from `panel`. */
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
  /** Advance the Control Panel state machine. `PICK` also creates the draft assignment (catalog defaults, pinned `catalogVersion`). */
  dispatchPanel: (event: PanelEvent) => void;
  /**
   * Thin wrapper over `dispatchPanel`: `vmId === null` is a `DESELECT`,
   * otherwise a `SELECT` that looks up whether `vmId` already has a draft
   * assignment (landing on `tuning` instead of `selected` when it does).
   */
  setSelectedVmId: (vmId: string | null) => void;
  /** Replace the draft assignment for `vmId` outright (e.g. changing its trigger). */
  setDraftAssignment: (vmId: string, assignment: Assignment) => void;
  /** Merge one param value into `vmId`'s draft assignment. No-op if `vmId` has no draft assignment. */
  updateDraftParam: (vmId: string, key: string, value: string) => void;
  /** Drop the draft assignment for `vmId`. */
  removeDraftAssignment: (vmId: string) => void;
  setMode: (mode: EditorMode) => void;
  reset: () => void;
};

export type EditorStore = EditorState & EditorActions;

export const initialEditorState: EditorState = {
  panel: initialPanelState,
  selectedVmId: null,
  draftState: {},
  currentVersionState: {},
  unsaved: false,
  mode: "editing",
};

function vmIdOf(panel: PanelState): string | null {
  return panel.status === "idle" ? null : panel.vmId;
}

function assignmentsEqual(a: Assignment | undefined, b: Assignment | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.animationId !== b.animationId) return false;
  if (a.catalogVersion !== b.catalogVersion) return false;
  if (a.trigger !== b.trigger) return false;

  const aKeys = Object.keys(a.params);
  const bKeys = Object.keys(b.params);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a.params[key] === b.params[key]);
}

/** Deep-equal for two `EditorStateMap`s (plain `vmId -> Assignment` maps of strings). */
function statesEqual(a: EditorStateMap, b: EditorStateMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => assignmentsEqual(a[key], b[key]));
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  ...initialEditorState,

  dispatchPanel: (event) =>
    set((state) => {
      const panel = transition(state.panel, event);
      const selectedVmId = vmIdOf(panel);

      // PICK's job is purely to choose an animation; creating the draft
      // assignment it implies (catalog defaults, pinned catalogVersion, the
      // entry's defaultTrigger) lives here so every caller of PICK gets it,
      // matching "PICK creates the draft assignment" in the task brief.
      if (event.type === "PICK" && panel.status === "tuning") {
        const entry = getCatalogEntry(event.animationId);
        if (entry) {
          const assignment: Assignment = {
            animationId: entry.id,
            catalogVersion: CURRENT_CATALOG_VERSION,
            trigger: entry.defaultTrigger ?? entry.triggers[0],
            params: resolveParams(entry as unknown as CatalogPackageEntry),
          };
          const draftState = { ...state.draftState, [panel.vmId]: assignment };
          return {
            panel,
            selectedVmId,
            draftState,
            unsaved: !statesEqual(draftState, state.currentVersionState),
          };
        }
      }

      return { panel, selectedVmId };
    }),

  setSelectedVmId: (vmId) => {
    const { draftState, dispatchPanel } = get();
    if (vmId === null) {
      dispatchPanel({ type: "DESELECT" });
      return;
    }
    dispatchPanel({ type: "SELECT", vmId, draftAnimationId: draftState[vmId]?.animationId });
  },

  setDraftAssignment: (vmId, assignment) =>
    set((state) => {
      const draftState = { ...state.draftState, [vmId]: assignment };
      return { draftState, unsaved: !statesEqual(draftState, state.currentVersionState) };
    }),

  updateDraftParam: (vmId, key, value) =>
    set((state) => {
      const existing = state.draftState[vmId];
      if (!existing) return state;
      const draftState = {
        ...state.draftState,
        [vmId]: { ...existing, params: { ...existing.params, [key]: value } },
      };
      return { draftState, unsaved: !statesEqual(draftState, state.currentVersionState) };
    }),

  removeDraftAssignment: (vmId) =>
    set((state) => {
      if (!(vmId in state.draftState)) return state;
      const draftState = { ...state.draftState };
      delete draftState[vmId];
      return { draftState, unsaved: !statesEqual(draftState, state.currentVersionState) };
    }),

  setMode: (mode) => set({ mode }),

  reset: () => set({ ...initialEditorState }),
}));

export type { Assignment, EditorStateMap };
export { transition, type PanelEvent, type PanelState } from "./panel-machine";
