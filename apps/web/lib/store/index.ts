/**
 * Editor store.
 *
 * Shape follows docs/architecture.md §4: the shell keeps
 * `draftState · currentVersionState · mode` in one Zustand store, plus the
 * Control Panel's `panel` state machine, which the Control Panel and the
 * bridge client both read.
 *
 * `selectedVmId` and `unsaved` are *derived*, not stored: `selectedVmId` is a
 * pure function of `panel`, and `unsaved` (like the set of elements it is the
 * emptiness of) a deep comparison of `draftState` against
 * `currentVersionState`. Mirroring them as their own state fields
 * would require every action that can change either input to remember to
 * recompute them — `currentVersionState` will get its own writers in Phase 6
 * (save/load/restore) that have no reason to know about `unsaved` — so
 * instead they're plain selectors (`selectSelectedVmId`, `selectUnsaved`) —
 * read through `useEditorStore(selector)`, or through the `useUnsaved` hook
 * wrapper — that can never drift out of sync with the state they're computed
 * from.
 *
 * Live preview edits stay in `draftState` and never hit the API;
 * `currentVersionState` only changes when a version is saved, loaded or
 * restored (Phase 6). No action in this module calls the API.
 */
import type { ElementInfo } from "bridge";
import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";

import type { Assignment, EditorStateMap } from "@/lib/api-client";
import { assignmentsEqual } from "@/lib/assignment";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";

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

/** What the unsaved-changes guard on an element switch was answered with. */
export type GuardOutcome = "discard" | "keep" | "saved";

export type EditorState = {
  /** Control Panel state machine (idle / selected / choosing / tuning). */
  panel: PanelState;
  /** Client-side draft: what the iframe currently shows. Never persisted until Save. */
  draftState: EditorStateMap;
  /** Materialised state of the version the draft was forked from. */
  currentVersionState: EditorStateMap;
  mode: EditorMode;
  /** Element the pointer is over inside the preview iframe (`element:hover`), or null. */
  hoverVmId: string | null;
  /**
   * What the bridge has told us about the elements in the cloned page, keyed by
   * `data-vm-id`. Metadata, not editor state: the selection ring's label and
   * the panel's element name read `tag` from here, and nothing in it is ever
   * saved. It fills in as elements are clicked, so every reader has to cope
   * with a vmId that is not in it yet.
   */
  elements: Record<string, ElementInfo>;
  /**
   * The element a selection change is waiting on, parked here while the
   * unsaved-changes guard asks what to do with the element being left
   * (spec §5). Null whenever no guard is open — `selectGuardOpen` is exactly
   * that test, which is why "the dialog is open" is not a second field.
   */
  pendingSelectVmId: string | null;
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
  /**
   * The top bar's Cancel: throw the draft away and go back to the current
   * version's state. The Control Panel follows the element it was on —
   * `tuning` when that element still has an assignment afterwards, `selected`
   * when the revert took it away (docs/design/README.md, "Interactions").
   */
  revertDraft: () => void;
  setMode: (mode: EditorMode) => void;
  /** `element:hover` from the bridge; `null` when the pointer left every tagged element. */
  setHoverVmId: (vmId: string | null) => void;
  /** Record what the bridge reported about an element (`element:select`). */
  rememberElement: (info: ElementInfo) => void;
  /**
   * Selection *asked for* from inside the iframe, which the guard may refuse —
   * as opposed to {@link EditorActions.setSelectedVmId}, which is the editor's
   * own UI moving the selection and always wins. Spec §5: same element is a
   * no-op; a clean element lets the selection through; a dirty one holds it
   * and opens the guard; a deselect (Escape, background click) while dirty is
   * ignored outright, since there is nothing to ask about that the user could
   * not answer by clicking an element.
   */
  requestSelect: (vmId: string | null) => void;
  /**
   * Answer the guard `requestSelect` opened. `discard` reverts *that one*
   * element to the saved version (not `revertDraft`, which throws away the
   * whole draft — the guard named one element, so it may only take one),
   * `keep` drops the pending selection, `saved` assumes the Save flow already
   * ran (Phase 6). All three end with the guard closed.
   */
  resolveGuard: (outcome: GuardOutcome) => void;
  reset: () => void;
};

export type EditorStore = EditorState & EditorActions;

/** A plain store handle — what the framework-free bridge client takes. */
export type EditorStoreApi = StoreApi<EditorStore>;
/** What {@link createEditorStore} returns: callable as a hook, and an {@link EditorStoreApi}. */
export type EditorStoreHook = UseBoundStore<StoreApi<EditorStore>>;

export const initialEditorState: EditorState = {
  panel: initialPanelState,
  draftState: {},
  currentVersionState: {},
  mode: "editing",
  hoverVmId: null,
  elements: {},
  pendingSelectVmId: null,
};

/** `data-vm-id` of the element selected in the preview iframe, or null when nothing is selected. */
export function selectSelectedVmId(state: EditorState): string | null {
  return state.panel.status === "idle" ? null : state.panel.vmId;
}

/**
 * Every element the draft has unsaved changes on: one the draft animated, one
 * the draft dropped, or one whose assignment moved. Derived on demand from the
 * two maps rather than mirrored as state, for the reason in the module header.
 *
 * It allocates, so components read one of the scalar selectors below rather
 * than subscribing to this directly (Zustand compares snapshots by identity,
 * and a fresh array every render is a fresh snapshot every render).
 */
export function selectDirtyVmIds(state: EditorState): string[] {
  const vmIds = new Set([
    ...Object.keys(state.draftState),
    ...Object.keys(state.currentVersionState),
  ]);
  return [...vmIds].filter(
    (vmId) => !assignmentsEqual(state.draftState[vmId], state.currentVersionState[vmId]),
  );
}

/** How many elements have unsaved changes — what the guard's generic copy counts. */
export function selectDirtyVmIdCount(state: EditorState): number {
  return selectDirtyVmIds(state).length;
}

/** True when `draftState` differs from `currentVersionState`. */
export function selectUnsaved(state: EditorState): boolean {
  return selectDirtyVmIds(state).length > 0;
}

/**
 * The one element the unsaved guard is allowed to name, or null for the
 * generic question (`docs/design/README.md` "3. Dialogs & toast").
 *
 * Two conditions, and both matter. The element has to be the *selected* one,
 * or "Save changes to h1?" points at whatever the user last clicked rather
 * than at what they changed. And it has to be the *only* dirty one, because
 * Discard calls `revertDraft()`, which throws the whole draft away — naming
 * one element while silently reverting three would declare a smaller loss
 * than the button delivers.
 */
export function selectGuardedVmId(state: EditorState): string | null {
  const dirty = selectDirtyVmIds(state);
  if (dirty.length !== 1) return null;
  return dirty[0] === selectSelectedVmId(state) ? dirty[0] : null;
}

/**
 * Whether *this one* element has unsaved changes — added, changed or removed.
 *
 * `selectDirtyVmIds` answers the same question for the whole draft but
 * allocates a set and an array to do it; the element-switch guard asks about
 * one element on every click from inside the iframe, so it asks here. `null`
 * (nothing selected) is never dirty.
 */
export function selectElementDirty(state: EditorState, vmId: string | null): boolean {
  if (vmId === null) return false;
  return !assignmentsEqual(state.draftState[vmId], state.currentVersionState[vmId]);
}

/**
 * Whether the element-switch guard is open. Derived, for the reason in the
 * module header: a `guardOpen` field next to `pendingSelectVmId` would be a
 * second thing to keep true, and the two could disagree.
 */
export function selectGuardOpen(state: EditorState): boolean {
  return state.pendingSelectVmId !== null;
}

/**
 * The machine is deliberately ignorant of `draftState`, so the store is what
 * tells `BACK` whether the element it is stepping out of the picker for
 * already has an assignment. Callers (`ChoosingPanel`'s "‹") just say `BACK`.
 */
function withDraftAnimationId(state: EditorState, event: PanelEvent): PanelEvent {
  if (event.type !== "BACK" || event.draftAnimationId !== undefined) return event;
  const vmId = selectSelectedVmId(state);
  if (vmId === null) return event;
  return { ...event, draftAnimationId: state.draftState[vmId]?.animationId };
}

const createEditorState: StateCreator<EditorStore> = (set, get) => ({
  ...initialEditorState,

  dispatchPanel: (event) =>
    set((state) => {
      const panel = transition(state.panel, withDraftAnimationId(state, event));
      if (panel === state.panel) return state;

      // PICK's job is purely to choose an animation; creating the draft
      // assignment it implies (catalog defaults, pinned catalogVersion, the
      // entry's defaultTrigger) lives here so every caller of PICK gets it,
      // matching "PICK creates the draft assignment" in the task brief.
      if (event.type === "PICK" && panel.status === "tuning") {
        // …except when the card picked is the one already applied. That is a
        // navigation back into tuning, not a new choice, and overwriting it
        // with catalog defaults would throw away everything the user tuned.
        if (state.draftState[panel.vmId]?.animationId === event.animationId) {
          return { panel };
        }

        const entry = getCatalogEntry(event.animationId);
        if (entry) {
          const assignment: Assignment = {
            animationId: entry.id,
            catalogVersion: CURRENT_CATALOG_VERSION,
            trigger: entry.defaultTrigger ?? entry.triggers[0],
            params: resolveCatalogParams(entry),
          };
          return { panel, draftState: { ...state.draftState, [panel.vmId]: assignment } };
        }
      }

      return { panel };
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
    set((state) => ({ draftState: { ...state.draftState, [vmId]: assignment } })),

  updateDraftParam: (vmId, key, value) =>
    set((state) => {
      const existing = state.draftState[vmId];
      if (!existing) return state;
      return {
        draftState: {
          ...state.draftState,
          [vmId]: { ...existing, params: { ...existing.params, [key]: value } },
        },
      };
    }),

  removeDraftAssignment: (vmId) =>
    set((state) => {
      if (!(vmId in state.draftState)) return state;
      const draftState = { ...state.draftState };
      delete draftState[vmId];
      return { draftState };
    }),

  revertDraft: () =>
    set((state) => {
      const draftState = { ...state.currentVersionState };
      const vmId = selectSelectedVmId(state);

      // Through the machine, not around it: `REVERT` is what decides where the
      // panel lands (and keeps `panel` identical when it does not move, so
      // subscribers that only read `panel` are not re-rendered).
      const panel = transition(state.panel, {
        type: "REVERT",
        draftAnimationId: vmId === null ? undefined : draftState[vmId]?.animationId,
      });

      return { draftState, panel };
    }),

  setMode: (mode) => set({ mode }),

  setHoverVmId: (vmId) =>
    // Identity matters: the bridge only reports a *change* of hovered element,
    // but the same vmId can arrive again after a re-`ready`, and a fresh
    // snapshot would re-render every subscriber over nothing.
    set((state) => (state.hoverVmId === vmId ? state : { hoverVmId: vmId })),

  rememberElement: (info) =>
    set((state) => ({ elements: { ...state.elements, [info.vmId]: info } })),

  requestSelect: (vmId) => {
    const state = get();
    const current = selectSelectedVmId(state);
    if (vmId === current) return;

    if (!selectElementDirty(state, current)) {
      state.setSelectedVmId(vmId);
      return;
    }

    // Dirty, and the request is a deselect: Escape and a background click do
    // nothing at all rather than raise a dialog the user did not ask for
    // (spec §5). Dirty and another element: hold the selection and ask.
    if (vmId === null) return;
    set({ pendingSelectVmId: vmId });
  },

  resolveGuard: (outcome) => {
    const state = get();
    const pending = state.pendingSelectVmId;
    if (pending === null) return;

    if (outcome === "keep") {
      set({ pendingSelectVmId: null });
      return;
    }

    if (outcome === "discard") {
      const vmId = selectSelectedVmId(state);
      if (vmId !== null) {
        const saved = state.currentVersionState[vmId];
        const draftState = { ...state.draftState };
        if (saved) draftState[vmId] = saved;
        else delete draftState[vmId];
        set({ draftState });
      }
    }

    // Clear the guard before moving, so a subscriber that reacts to the
    // selection (the bridge client) never sees a selection change with a
    // dialog still nominally open.
    set({ pendingSelectVmId: null });
    get().setSelectedVmId(pending);
  },

  reset: () => set({ ...initialEditorState }),
});

/**
 * A fresh, independent store.
 *
 * `useEditorStore` below is the module-scope default instance every component
 * reads (DT-026's first half: harmless while nothing writes during render).
 * This factory exists so the bridge client's tests — and, when DT-090 lands, a
 * React context provider — can hold a store of their own instead of resetting
 * a shared one between cases.
 */
export function createEditorStore(): EditorStoreHook {
  return create<EditorStore>()(createEditorState);
}

export const useEditorStore: EditorStoreHook = createEditorStore();

/** `useEditorStore(selectUnsaved)`, as a named hook. */
export function useUnsaved(): boolean {
  return useEditorStore(selectUnsaved);
}

export type { Assignment, EditorStateMap, ElementInfo };
export { transition, type PanelEvent, type PanelState } from "./panel-machine";
