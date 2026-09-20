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
 * from. `guardOpen` (`selectGuardOpen`) is the Phase 4 addition to that list.
 *
 * Phase 4 also adds what the preview iframe reports (`hoverVmId`, `elements`)
 * and the element-switch guard (`pendingSelectVmId`, `requestSelect`,
 * `resolveGuard`); `createEditorStore()` hands out an independent instance so
 * the bridge client's tests are not sharing the module-scope default.
 *
 * Phase 5 adds what the agent did (`prompt`, `generated`, `lastRun`). All three
 * are client-only — they never enter a diff — and "agent-owned" is, once more,
 * derived: an element is agent-owned while its draft assignment still equals
 * what the agent produced for it (plan D2), so no edit path keeps a flag.
 *
 * Live preview edits stay in `draftState` and never hit the API;
 * `currentVersionState` only changes when a version is saved, loaded or
 * restored (Phase 6). No action in this module calls the API.
 */
import type { ElementInfo } from "bridge";
import { create, type StateCreator, type StoreApi, type UseBoundStore } from "zustand";

import type { PageSuggestion, Viewport } from "@/lib/agent/types";
import type { Assignment, EditorStateMap } from "@/lib/api-client";
import { assignmentsEqual } from "@/lib/assignment";
import { defaultAssignmentFor, getCatalogEntry } from "@/lib/catalog";

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

/** What the last page auto-generate (or Regenerate) run did — the result list's source. */
export type LastRun = {
  /** Regenerate re-rolls with `seed + 1` (plan D7). */
  seed: number;
  /** The prompt as it was when the run started; the result view quotes it. */
  prompt: string;
  /**
   * The result list's elements: the previous run's that still had an assignment
   * (so a hand-tuned row survives a Regenerate), then the ones this run
   * assigned, in the suggestion's order. No duplicates.
   */
  vmIds: string[];
  skippedCount: number;
  /** The bridge had more matching elements than it listed. */
  truncated: boolean;
  viewport: Viewport;
};

/** What `applyPageSuggestion` takes: the agent's answer plus the facts of the run. */
export type PageSuggestionInput = {
  suggestion: PageSuggestion;
  seed: number;
  prompt: string;
  truncated: boolean;
  viewport: Viewport;
};

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
  /**
   * The element the open guard is *about* — the one it named and the only one
   * Discard may revert.
   *
   * Not the same question as {@link selectGuardedVmId}, which asks whether the
   * dialog's copy may name an element at all. This is recorded when the guard
   * opens, because by the time it is answered the selection may have moved on
   * its own: Phase 5's result-list rows and Phase 6's version load both call
   * `setSelectedVmId` programmatically, and reading the selection at that
   * point would revert an element the dialog never mentioned.
   */
  guardedVmId: string | null;
  /** The idle panel's prompt textarea (plan D8). Client-only. */
  prompt: string;
  /**
   * Each assignment exactly as the agent produced it, keyed by vmId (plan D2).
   * Client-only provenance: never saved, never sent to the frame. An element is
   * agent-owned while `draftState[vmId]` still equals its entry here.
   */
  generated: Record<string, Assignment>;
  /** The last page run, or null before the first one (and after a revert). */
  lastRun: LastRun | null;
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
   * The same for a whole `elements:list`, in one update: 200 `rememberElement`
   * calls would be 200 store notifications. The newer report wins.
   */
  rememberElements: (infos: ElementInfo[]) => void;
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
  setPrompt: (prompt: string) => void;
  /**
   * "✦ Auto-generate for this element": write the agent's assignment into the
   * draft, remember it as agent-made, and — when the panel is still `selected`
   * on `vmId` — move it to `tuning`, keeping `returnTo`. The agent is async: if
   * the designer moved on meanwhile (another element, or the picker on this
   * one) the draft is still written but the panel is left where they put it;
   * if they gave the element an animation of their own meanwhile, nothing is
   * written at all. A no-op while viewing.
   */
  applyGenerated: (vmId: string, assignment: Assignment) => void;
  /**
   * A page run, applied in one `set()` so the bridge subscriber sees one
   * change. Assigns every suggested element that is unassigned or agent-owned;
   * a user-owned one is never overwritten, whatever the suggestion says. A
   * no-op while viewing.
   */
  applyPageSuggestion: (input: PageSuggestionInput) => void;
  /**
   * The result list's "Remove all": drops agent-owned assignments only and
   * forgets all provenance. `lastRun` stays (hand-tuned rows remain listed);
   * `auto` closes to `idle` once no row of the last run is left. An identity
   * no-op with nothing to forget, and while viewing.
   */
  removeAllGenerated: () => void;
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
  guardedVmId: null,
  prompt: "",
  generated: {},
  lastRun: null,
};

/** `data-vm-id` of the element selected in the preview iframe, or null when nothing is selected. */
export function selectSelectedVmId(state: EditorState): string | null {
  return "vmId" in state.panel ? state.panel.vmId : null;
}

/**
 * One-entry memo for {@link selectDirtyVmIds}, keyed on the identity of the two
 * maps it reads.
 *
 * Every action in this module replaces `draftState` / `currentVersionState`
 * wholesale rather than mutating them, so their identity is a complete
 * description of the answer. That makes this safe across store instances too:
 * two `createEditorStore()`s alternating simply miss the cache.
 *
 * It exists because three panel subscribers (`selectUnsaved`,
 * `selectDirtyVmIdCount`, `selectGuardedVmId`) run this on *every* store
 * change — including each `setHoverVmId`, which on a 200-element page means a
 * Set, an array and a deep comparison per hovered element, for no reader at
 * all (DT-126).
 */
let dirtyCache: { draft: EditorStateMap; saved: EditorStateMap; vmIds: string[] } | null = null;

/**
 * Every element the draft has unsaved changes on: one the draft animated, one
 * the draft dropped, or one whose assignment moved. Derived on demand from the
 * two maps rather than mirrored as state, for the reason in the module header.
 *
 * **The returned array is cached and shared — callers must not mutate it.**
 * Components read one of the scalar selectors below rather than subscribing to
 * this directly (Zustand compares snapshots by identity, and a fresh array
 * every render would be a fresh snapshot every render).
 */
export function selectDirtyVmIds(state: EditorState): string[] {
  const { draftState, currentVersionState } = state;
  if (dirtyCache && dirtyCache.draft === draftState && dirtyCache.saved === currentVersionState) {
    return dirtyCache.vmIds;
  }

  // No identity fast path for `draftState === currentVersionState`: nothing in
  // this module ever makes the two the same object — `initialEditorState` holds
  // two distinct `{}`, `reset()` re-uses those same two, and `revertDraft`
  // allocates a copy — so it would be unreachable. The cache above is what does
  // the work, and it answers a clean pair by identity just as well as a dirty
  // one, whether or not a later phase's save ever shares the two.
  const vmIds = [
    ...new Set([...Object.keys(draftState), ...Object.keys(currentVersionState)]),
  ].filter((vmId) => !assignmentsEqual(draftState[vmId], currentVersionState[vmId]));

  dirtyCache = { draft: draftState, saved: currentVersionState, vmIds };
  return vmIds;
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
  if (assignmentsEqual(state.draftState[vmId], state.currentVersionState[vmId])) return false;
  // Plan D2: untouched agent work is unsaved (every selector above still counts
  // it) but it is not something the designer would lose by clicking away, so
  // the element-switch guard — this function's one caller — lets it go.
  return !isAgentOwned(state, vmId);
}

/** `vmId` has a draft assignment and it is still exactly what the agent produced. */
function isAgentOwned(
  state: Pick<EditorState, "draftState" | "generated">,
  vmId: string,
): boolean {
  const draft = state.draftState[vmId];
  const made = state.generated[vmId];
  return draft !== undefined && made !== undefined && assignmentsEqual(draft, made);
}

/**
 * One-entry memos for the two array selectors below, keyed on the identity of
 * exactly the maps each one reads — deliberately not `dirtyCache`, which knows
 * nothing of `generated` or `lastRun`. Same contract as `selectDirtyVmIds`:
 * the arrays are shared, callers must not mutate them.
 */
let agentOwnedCache: {
  draft: EditorStateMap;
  generated: Record<string, Assignment>;
  vmIds: string[];
} | null = null;
let autoResultCache: { draft: EditorStateMap; lastRun: LastRun | null; vmIds: string[] } | null =
  null;

/** Elements whose draft assignment is still exactly what the agent produced (plan D2). */
export function selectAgentOwnedVmIds(state: EditorState): string[] {
  const { draftState, generated } = state;
  if (
    agentOwnedCache &&
    agentOwnedCache.draft === draftState &&
    agentOwnedCache.generated === generated
  ) {
    return agentOwnedCache.vmIds;
  }
  const vmIds = Object.keys(generated).filter((vmId) => isAgentOwned(state, vmId));
  agentOwnedCache = { draft: draftState, generated, vmIds };
  return vmIds;
}

/**
 * Split what the bridge listed into what a page run may assign and what it must
 * leave alone (plan D2): `candidates` have no draft assignment or an
 * agent-owned one; every user-owned element's assignment goes to the agent as
 * `existing` context instead. Allocates — call it per run, not per render.
 */
export function selectAutoCandidates(
  state: EditorState,
  elements: ElementInfo[],
): { candidates: ElementInfo[]; existing: Record<string, Assignment> } {
  const candidates: ElementInfo[] = [];
  const existing: Record<string, Assignment> = {};
  for (const element of elements) {
    const draft = state.draftState[element.vmId];
    if (draft === undefined || isAgentOwned(state, element.vmId)) candidates.push(element);
    else existing[element.vmId] = draft;
  }
  return { candidates, existing };
}

/** The result list's rows: the last run's elements that still have a draft assignment (plan D3). */
export function selectAutoResultVmIds(state: EditorState): string[] {
  const { draftState, lastRun } = state;
  if (autoResultCache && autoResultCache.draft === draftState && autoResultCache.lastRun === lastRun) {
    return autoResultCache.vmIds;
  }
  const vmIds = (lastRun?.vmIds ?? []).filter((vmId) => draftState[vmId] !== undefined);
  autoResultCache = { draft: draftState, lastRun, vmIds };
  return vmIds;
}

/** `map` without `key`; `map` itself when `key` is not in it. */
function without<T>(map: Record<string, T>, key: string): Record<string, T> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
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

/** Drop an open guard without answering it. */
function closeGuard(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
): void {
  if (get().pendingSelectVmId === null && get().guardedVmId === null) return;
  set({ pendingSelectVmId: null, guardedVmId: null });
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
          return {
            panel,
            draftState: { ...state.draftState, [panel.vmId]: defaultAssignmentFor(entry) },
            // A hand pick, even one that happens to equal what the agent once
            // made here, is the designer's: forget the provenance (plan D2).
            generated: without(state.generated, panel.vmId),
          };
        }
      }

      return { panel };
    }),

  setSelectedVmId: (vmId) => {
    const { draftState, dispatchPanel } = get();
    // The editor's own selection move always wins, and it invalidates any
    // open guard: the question was about the element being left, and the
    // editor has just left it by another route.
    closeGuard(set, get);
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
      if (!(vmId in state.draftState) && !(vmId in state.generated)) return state;
      return {
        draftState: without(state.draftState, vmId),
        // Stale provenance (plan D2): see `PICK` above.
        generated: without(state.generated, vmId),
      };
    }),

  revertDraft: () => {
    closeGuard(set, get);
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

      // The whole draft is gone, agent work included (plan D2). `prompt` is
      // what the designer typed, not part of the draft: it stays.
      const generated = Object.keys(state.generated).length > 0 ? {} : state.generated;
      return { draftState, panel, generated, lastRun: null };
    });
  },

  setMode: (mode) => set({ mode }),

  setHoverVmId: (vmId) =>
    // Identity matters: the bridge only reports a *change* of hovered element,
    // but the same vmId can arrive again after a re-`ready`, and a fresh
    // snapshot would re-render every subscriber over nothing.
    set((state) => (state.hoverVmId === vmId ? state : { hoverVmId: vmId })),

  rememberElement: (info) =>
    set((state) => ({ elements: { ...state.elements, [info.vmId]: info } })),

  rememberElements: (infos) =>
    set((state) => {
      if (infos.length === 0) return state;
      const elements = { ...state.elements };
      for (const info of infos) elements[info.vmId] = info;
      return { elements };
    }),

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
    set({ pendingSelectVmId: vmId, guardedVmId: current });
  },

  resolveGuard: (outcome) => {
    const state = get();
    const pending = state.pendingSelectVmId;
    if (pending === null) return;
    const guarded = state.guardedVmId;

    if (outcome === "keep") {
      set({ pendingSelectVmId: null, guardedVmId: null });
      return;
    }

    if (outcome === "discard" && guarded !== null) {
      // The element the dialog named, read from when it opened — not whatever
      // is selected now.
      // …back to the saved version when there is one; else back to what the
      // agent made, when it made something (plan D2: discarding a hand edit of
      // generated work must not also discard the generated work); else gone.
      const restored = state.currentVersionState[guarded] ?? state.generated[guarded];
      const draftState = { ...state.draftState };
      if (restored) draftState[guarded] = restored;
      else delete draftState[guarded];
      set({ draftState });
    }

    // Clear the guard before moving, so a subscriber that reacts to the
    // selection (the bridge client) never sees a selection change with a
    // dialog still nominally open. `setSelectedVmId` closes it too, which is
    // harmless: it is already closed.
    set({ pendingSelectVmId: null, guardedVmId: null });
    get().setSelectedVmId(pending);
  },

  setPrompt: (prompt) => set((state) => (state.prompt === prompt ? state : { prompt })),

  applyGenerated: (vmId, assignment) =>
    set((state) => {
      if (state.mode === "viewing") return state;
      // The agent is async: the designer may have picked something for this
      // element meanwhile, and one click never discards hand work (plan D2).
      if (state.draftState[vmId] !== undefined && !isAgentOwned(state, vmId)) return state;
      // Only from the panel the button lives on. Same element but `choosing`
      // means the designer opened the picker while the agent was thinking: the
      // draft is written, the picker stays.
      const onSelected = state.panel.status === "selected" && state.panel.vmId === vmId;
      return {
        draftState: { ...state.draftState, [vmId]: assignment },
        generated: { ...state.generated, [vmId]: assignment },
        // `SELECT` with the new `draftAnimationId` is the machine's existing
        // "this element, tuning this animation, keep `returnTo`" — no new event.
        panel: onSelected
          ? transition(state.panel, {
              type: "SELECT",
              vmId,
              draftAnimationId: assignment.animationId,
            })
          : state.panel,
      };
    }),

  applyPageSuggestion: ({ suggestion, seed, prompt, truncated, viewport }) =>
    set((state) => {
      if (state.mode === "viewing") return state;
      const draftState = { ...state.draftState };
      const generated = { ...state.generated };
      const assigned: string[] = [];
      for (const [vmId, assignment] of Object.entries(suggestion.assignments)) {
        // User-owned: in the draft and no longer (or never) what the agent made.
        if (state.draftState[vmId] !== undefined && !isAgentOwned(state, vmId)) continue;
        draftState[vmId] = assignment;
        generated[vmId] = assignment;
        assigned.push(vmId);
      }
      // The previous run's rows that still have an assignment stay listed —
      // a hand-tuned row survives a Regenerate as "edited" (plan D3) — then
      // whatever this run added. A Set keeps first-seen order and de-duplicates.
      const vmIds = [
        ...new Set([
          ...(state.lastRun?.vmIds ?? []).filter((vmId) => draftState[vmId] !== undefined),
          ...assigned,
        ]),
      ];
      return {
        draftState,
        generated,
        lastRun: {
          seed,
          prompt,
          vmIds,
          skippedCount: suggestion.skipped.length,
          truncated,
          viewport,
        },
        // Inside this updater, not via `dispatchPanel`: that is a second `set()`.
        panel: transition(state.panel, { type: "AUTO_DONE" }),
      };
    }),

  removeAllGenerated: () =>
    set((state) => {
      if (state.mode === "viewing") return state;
      const owned = Object.keys(state.generated).filter((vmId) => isAgentOwned(state, vmId));
      // `generated` non-empty with nothing owned still forgets the provenance.
      if (owned.length === 0 && Object.keys(state.generated).length === 0) return state;

      let draftState = state.draftState;
      if (owned.length > 0) {
        draftState = { ...state.draftState };
        for (const vmId of owned) delete draftState[vmId];
      }

      let panel = state.panel;
      const selected = selectSelectedVmId(state);
      if (selected !== null && state.draftState[selected] && !draftState[selected]) {
        // The element the panel is on just lost its assignment. The button
        // only exists on `auto`, where nothing is selected, but the action is
        // public and `tuning` without a draft assignment is a broken panel.
        panel = transition(panel, { type: "CLEAR" });
      }
      const rowLeft = (state.lastRun?.vmIds ?? []).some((vmId) => draftState[vmId] !== undefined);
      if (!rowLeft) panel = transition(panel, { type: "AUTO_CLOSE" });

      return { draftState, generated: {}, panel };
    }),

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
