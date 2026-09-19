import type { ElementInfo } from "bridge";
import { beforeEach, describe, expect, it } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";

import {
  createEditorStore,
  initialEditorState,
  selectDirtyVmIdCount,
  selectDirtyVmIds,
  selectElementDirty,
  selectGuardedVmId,
  selectGuardOpen,
  selectSelectedVmId,
  selectUnsaved,
  useEditorStore,
} from "./index";

/** A catalog-default assignment, the way `PICK` builds one. */
function assignmentFor(animationId: string) {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`no catalog entry ${animationId}`);
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  };
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("useEditorStore panel/draft integration", () => {
  it("starts idle with no selection and clean draft", () => {
    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "idle" });
    expect(selectSelectedVmId(state)).toBeNull();
    expect(selectUnsaved(state)).toBe(false);
  });

  it("setSelectedVmId dispatches SELECT and keeps selectedVmId in sync", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "selected", vmId: "vm-1" });
    expect(selectSelectedVmId(state)).toBe("vm-1");
  });

  it("setSelectedVmId(null) dispatches DESELECT", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().setSelectedVmId(null);
    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "idle" });
    expect(selectSelectedVmId(state)).toBeNull();
  });

  it("selecting an element with a draft assignment lands on tuning", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().setSelectedVmId("vm-2");
    useEditorStore.getState().setSelectedVmId("vm-1");

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });
  });

  it("PICK creates a defaulted, pinned draft assignment and flips unsaved", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    const state = useEditorStore.getState();
    const entry = getCatalogEntry("fade-in")!;
    expect(state.draftState["vm-1"]).toEqual({
      animationId: "fade-in",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger,
      params: resolveCatalogParams(entry),
    });
    expect(selectUnsaved(state)).toBe(true);
    expect(state.panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });
  });

  it("updateDraftParam merges one param and keeps unsaved true", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().updateDraftParam("vm-1", "duration", "900ms");

    const state = useEditorStore.getState();
    expect(state.draftState["vm-1"].params.duration).toBe("900ms");
    expect(selectUnsaved(state)).toBe(true);
  });

  it("updateDraftParam is a no-op when the vmId has no draft assignment", () => {
    const before = useEditorStore.getState();
    useEditorStore.getState().updateDraftParam("vm-missing", "duration", "900ms");
    expect(useEditorStore.getState()).toEqual(before);
  });

  it("removeDraftAssignment drops the assignment and restores clean when it matches currentVersionState", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    expect(selectUnsaved(useEditorStore.getState())).toBe(true);

    useEditorStore.getState().removeDraftAssignment("vm-1");

    const state = useEditorStore.getState();
    expect(state.draftState["vm-1"]).toBeUndefined();
    expect(selectUnsaved(state)).toBe(false);
  });

  it("unsaved reflects a deep comparison against currentVersionState, not identity", () => {
    const entry = getCatalogEntry("fade-in")!;
    const assignment = {
      animationId: "fade-in",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger!,
      params: resolveCatalogParams(entry),
    };
    useEditorStore.setState({
      currentVersionState: { "vm-1": assignment },
    });

    // A structurally-identical but distinct object assigned to the draft
    // must not be flagged unsaved.
    useEditorStore.getState().setDraftAssignment("vm-1", { ...assignment, params: { ...assignment.params } });
    expect(selectUnsaved(useEditorStore.getState())).toBe(false);

    useEditorStore.getState().updateDraftParam("vm-1", "duration", "1200ms");
    expect(selectUnsaved(useEditorStore.getState())).toBe(true);
  });

  it("unsaved is derived: changing currentVersionState alone (no draft action) flips it, e.g. after a Phase 6 save/load/restore", () => {
    const entry = getCatalogEntry("fade-in")!;
    const assignment = {
      animationId: "fade-in",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger!,
      params: resolveCatalogParams(entry),
    };

    useEditorStore.setState({ draftState: { "vm-1": assignment } });
    expect(selectUnsaved(useEditorStore.getState())).toBe(true);

    // Nothing that touches `unsaved` directly is called — only
    // `currentVersionState` changes (e.g. a version load/restore would do
    // exactly this), and the derived selector still reflects it.
    useEditorStore.setState({ currentVersionState: { "vm-1": assignment } });
    expect(selectUnsaved(useEditorStore.getState())).toBe(false);

    useEditorStore.setState({ currentVersionState: {} });
    expect(selectUnsaved(useEditorStore.getState())).toBe(true);
  });

  it("reset restores the initial state", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().reset();

    expect(useEditorStore.getState()).toMatchObject(initialEditorState);
  });

  it("revertDraft restores the current version's state and clears unsaved", () => {
    const entry = getCatalogEntry("fade-in")!;
    const saved = {
      animationId: "pulse",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load" as const,
      params: resolveCatalogParams(getCatalogEntry("pulse")!),
    };
    useEditorStore.setState({ currentVersionState: { "vm-9": saved } });
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: entry.id });

    useEditorStore.getState().revertDraft();

    const state = useEditorStore.getState();
    expect(state.draftState).toEqual({ "vm-9": saved });
    expect(selectUnsaved(state)).toBe(false);
  });

  it("revertDraft leaves the selected element on `selected` when the revert removed its assignment", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().revertDraft();

    expect(useEditorStore.getState().panel).toEqual({ status: "selected", vmId: "vm-1" });
  });

  it("revertDraft lands on `tuning` when the selected element still has an assignment", () => {
    const saved = {
      animationId: "pulse",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load" as const,
      params: resolveCatalogParams(getCatalogEntry("pulse")!),
    };
    useEditorStore.setState({ currentVersionState: { "vm-1": saved } });
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().revertDraft();

    expect(useEditorStore.getState().panel).toEqual({
      status: "tuning",
      vmId: "vm-1",
      animationId: "pulse",
    });
  });

  it("revertDraft stays idle when nothing is selected", () => {
    useEditorStore.getState().setDraftAssignment("vm-1", {
      animationId: "fade-in",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    });

    useEditorStore.getState().revertDraft();

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "idle" });
    expect(state.draftState).toEqual({});
  });

  it("revertDraft keeps the same panel object when nothing about it changes", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    const before = useEditorStore.getState().panel;

    useEditorStore.getState().revertDraft();

    expect(useEditorStore.getState().panel).toBe(before);
  });

  it("BACK from tuning returns to choosing, keeping the draft assignment", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().dispatchPanel({ type: "BACK" });

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "choosing", vmId: "vm-1" });
    expect(state.draftState["vm-1"]).toBeDefined();
  });

  it("Change then ‹ returns to tuning, not to an empty `selected`", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    useEditorStore.getState().updateDraftParam("vm-1", "duration", "900ms");

    // "Change" → the picker, then "‹" out of it again.
    useEditorStore.getState().dispatchPanel({ type: "BACK" });
    useEditorStore.getState().dispatchPanel({ type: "BACK" });

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });
    expect(state.draftState["vm-1"].params.duration).toBe("900ms");
  });

  it("‹ out of the picker lands on `selected` when the element has nothing on it", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });

    useEditorStore.getState().dispatchPanel({ type: "BACK" });

    expect(useEditorStore.getState().panel).toEqual({ status: "selected", vmId: "vm-1" });
  });

  it("re-picking the animation already applied keeps every tuned value", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    useEditorStore.getState().updateDraftParam("vm-1", "duration", "900ms");
    useEditorStore.getState().setDraftAssignment("vm-1", {
      ...useEditorStore.getState().draftState["vm-1"],
      trigger: "hover",
    });

    useEditorStore.getState().dispatchPanel({ type: "BACK" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });
    expect(state.draftState["vm-1"].params.duration).toBe("900ms");
    expect(state.draftState["vm-1"].trigger).toBe("hover");
  });

  it("picking a different animation does start from the catalog's defaults", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    useEditorStore.getState().updateDraftParam("vm-1", "duration", "900ms");

    useEditorStore.getState().dispatchPanel({ type: "BACK" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });

    const entry = getCatalogEntry("fade-in-up")!;
    expect(useEditorStore.getState().draftState["vm-1"]).toEqual({
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger,
      params: resolveCatalogParams(entry),
    });
  });
});

describe("dirty-element selectors", () => {
  /** A saved version holding one assignment on `vm-1`. */
  function withSavedAssignment(vmId: string, animationId: string) {
    const entry = getCatalogEntry(animationId);
    if (!entry) throw new Error(`fixture: no catalog entry "${animationId}"`);
    const assignment = {
      animationId: entry.id,
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger ?? entry.triggers[0],
      params: resolveCatalogParams(entry),
    };
    useEditorStore.setState({
      currentVersionState: { [vmId]: assignment },
      draftState: { [vmId]: assignment },
    });
  }

  it("lists nothing while the draft matches the saved version", () => {
    withSavedAssignment("vm-1", "fade-in-up");
    const state = useEditorStore.getState();

    expect(selectDirtyVmIds(state)).toEqual([]);
    expect(selectDirtyVmIdCount(state)).toBe(0);
    expect(selectUnsaved(state)).toBe(false);
  });

  it("lists an element whose animation is new in the draft", () => {
    useEditorStore.getState().setDraftAssignment("vm-1", {
      animationId: "fade-in",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    });

    expect(selectDirtyVmIds(useEditorStore.getState())).toEqual(["vm-1"]);
  });

  it("lists an element whose own params have moved", () => {
    withSavedAssignment("vm-1", "fade-in-up");
    useEditorStore.getState().updateDraftParam("vm-1", "duration", "800ms");

    expect(selectDirtyVmIds(useEditorStore.getState())).toEqual(["vm-1"]);
  });

  it("lists an element the draft dropped, which only the saved version still has", () => {
    withSavedAssignment("vm-1", "fade-in-up");
    useEditorStore.getState().removeDraftAssignment("vm-1");

    expect(selectDirtyVmIds(useEditorStore.getState())).toEqual(["vm-1"]);
  });

  it("counts every element with unsaved changes, not just the selected one", () => {
    withSavedAssignment("vm-1", "fade-in-up");
    useEditorStore.getState().updateDraftParam("vm-1", "duration", "800ms");
    useEditorStore.getState().setDraftAssignment("vm-2", {
      animationId: "pulse",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    });
    useEditorStore.getState().setSelectedVmId("vm-1");
    const state = useEditorStore.getState();

    expect(selectDirtyVmIds(state).sort()).toEqual(["vm-1", "vm-2"]);
    expect(selectDirtyVmIdCount(state)).toBe(2);
  });
});

/**
 * Discard reverts the whole draft, so the guard may only name an element when
 * naming it describes everything a discard would take away.
 */
describe("selectGuardedVmId", () => {
  function pick(vmId: string, animationId: string) {
    useEditorStore.getState().setSelectedVmId(vmId);
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId });
  }

  it("is null while the draft is clean", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");

    expect(selectGuardedVmId(useEditorStore.getState())).toBeNull();
  });

  it("is the selected element when it is the only one that changed", () => {
    pick("vm-1", "fade-in-up");

    expect(selectGuardedVmId(useEditorStore.getState())).toBe("vm-1");
  });

  it("is null when the one element that changed is not the selected one", () => {
    pick("vm-1", "fade-in-up");
    useEditorStore.getState().setSelectedVmId("vm-2");

    expect(selectGuardedVmId(useEditorStore.getState())).toBeNull();
  });

  it("is null when a second element has unsaved changes too", () => {
    pick("vm-1", "fade-in-up");
    pick("vm-2", "pulse");

    // vm-2 is selected and dirty, but discarding would take vm-1 as well.
    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-2");
    expect(selectGuardedVmId(useEditorStore.getState())).toBeNull();
  });

  it("is null when nothing is selected, however dirty the draft is", () => {
    pick("vm-1", "fade-in-up");
    useEditorStore.getState().setSelectedVmId(null);

    expect(selectUnsaved(useEditorStore.getState())).toBe(true);
    expect(selectGuardedVmId(useEditorStore.getState())).toBeNull();
  });
});

/**
 * Phase 4 additions: a store factory so the bridge client's tests get a fresh
 * store, the element metadata the bridge reports, and the element-switch guard
 * (docs/plans/phase-4-bridge-protocol.md §5, D10).
 */
describe("createEditorStore", () => {
  it("hands out independent stores", () => {
    const a = createEditorStore();
    const b = createEditorStore();

    a.getState().setDraftAssignment("vm-1", {
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    });

    expect(Object.keys(a.getState().draftState)).toEqual(["vm-1"]);
    expect(b.getState().draftState).toEqual({});
    // …and neither is the module-scope default every component reads.
    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("starts from the same initial state as the default instance", () => {
    const store = createEditorStore();

    expect(store.getState().panel).toEqual({ status: "idle" });
    expect(store.getState().hoverVmId).toBeNull();
    expect(store.getState().elements).toEqual({});
    expect(store.getState().pendingSelectVmId).toBeNull();
  });
});

describe("element metadata from the iframe", () => {
  const heading: ElementInfo = {
    vmId: "vm-1",
    tag: "h1",
    role: null,
    textPreview: "Welcome",
    rect: { x: 0, y: 0, width: 100, height: 20 },
    pageRect: { x: 0, y: 0, width: 100, height: 20 },
    order: 0,
    visible: true,
  };

  it("remembers what the bridge reported, keyed by vmId", () => {
    const store = createEditorStore();
    store.getState().rememberElement(heading);

    expect(store.getState().elements["vm-1"]).toEqual(heading);
  });

  it("tracks the hovered element and clears it on leave", () => {
    const store = createEditorStore();
    store.getState().setHoverVmId("vm-1");
    expect(store.getState().hoverVmId).toBe("vm-1");

    store.getState().setHoverVmId(null);
    expect(store.getState().hoverVmId).toBeNull();
  });

  it("reset() clears the metadata, the hover and any open guard", () => {
    const store = createEditorStore();
    store.getState().rememberElement(heading);
    store.getState().setHoverVmId("vm-1");
    store.setState({ pendingSelectVmId: "vm-2" });

    store.getState().reset();

    expect(store.getState().elements).toEqual({});
    expect(store.getState().hoverVmId).toBeNull();
    expect(store.getState().pendingSelectVmId).toBeNull();
  });
});

describe("selectElementDirty", () => {
  it("is false for a clean element and for no element at all", () => {
    const store = createEditorStore();

    expect(selectElementDirty(store.getState(), "vm-1")).toBe(false);
    expect(selectElementDirty(store.getState(), null)).toBe(false);
  });

  it("is true for an added, a changed and a removed assignment", () => {
    const store = createEditorStore();
    const saved = {
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load" as const,
      params: { duration: "600ms" },
    };

    store.getState().setDraftAssignment("vm-1", saved);
    expect(selectElementDirty(store.getState(), "vm-1")).toBe(true); // added

    store.setState({ currentVersionState: { "vm-1": saved } });
    expect(selectElementDirty(store.getState(), "vm-1")).toBe(false);

    store.getState().updateDraftParam("vm-1", "duration", "1200ms");
    expect(selectElementDirty(store.getState(), "vm-1")).toBe(true); // changed

    store.getState().removeDraftAssignment("vm-1");
    expect(selectElementDirty(store.getState(), "vm-1")).toBe(true); // removed
  });
});

describe("requestSelect — the unsaved-changes guard on element switch", () => {
  function freshWithDirty(vmId: string) {
    const store = createEditorStore();
    store.getState().setSelectedVmId(vmId);
    store.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    return store;
  }

  it("selects freely while the selected element is clean", () => {
    const store = createEditorStore();
    store.getState().setSelectedVmId("vm-1");

    store.getState().requestSelect("vm-2");

    expect(selectSelectedVmId(store.getState())).toBe("vm-2");
    expect(selectGuardOpen(store.getState())).toBe(false);
  });

  it("re-selecting the element already selected is a no-op", () => {
    const store = createEditorStore();
    store.getState().setSelectedVmId("vm-1");
    const before = store.getState().panel;

    store.getState().requestSelect("vm-1");

    expect(store.getState().panel).toBe(before);
    expect(selectGuardOpen(store.getState())).toBe(false);
  });

  it("holds the selection and opens the guard when the selected element is dirty", () => {
    const store = freshWithDirty("vm-1");

    store.getState().requestSelect("vm-2");

    expect(selectSelectedVmId(store.getState())).toBe("vm-1");
    expect(store.getState().pendingSelectVmId).toBe("vm-2");
    expect(selectGuardOpen(store.getState())).toBe(true);
  });

  it("counts a changed param as dirty too", () => {
    const store = createEditorStore();
    const saved = {
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load" as const,
      params: { duration: "600ms" },
    };
    store.setState({ currentVersionState: { "vm-1": saved }, draftState: { "vm-1": saved } });
    store.getState().setSelectedVmId("vm-1");
    store.getState().updateDraftParam("vm-1", "duration", "1200ms");

    store.getState().requestSelect("vm-2");

    expect(selectSelectedVmId(store.getState())).toBe("vm-1");
    expect(selectGuardOpen(store.getState())).toBe(true);
  });

  it("ignores a deselect while dirty, and honours it while clean (spec §5)", () => {
    const store = freshWithDirty("vm-1");

    store.getState().requestSelect(null);

    expect(selectSelectedVmId(store.getState())).toBe("vm-1");
    expect(selectGuardOpen(store.getState())).toBe(false);

    store.getState().revertDraft();
    store.getState().requestSelect(null);

    expect(selectSelectedVmId(store.getState())).toBeNull();
  });
});

describe("resolveGuard", () => {
  function dirtyWithPending() {
    const store = createEditorStore();
    // vm-9 is dirty too, and must survive a Discard aimed at vm-1.
    store.getState().setDraftAssignment("vm-9", {
      animationId: "pulse",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    });
    store.getState().setSelectedVmId("vm-1");
    store.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    store.getState().requestSelect("vm-2");
    return store;
  }

  it("discard reverts only the guarded element, then selects the pending one", () => {
    const store = dirtyWithPending();

    store.getState().resolveGuard("discard");

    expect(store.getState().draftState["vm-1"]).toBeUndefined();
    expect(store.getState().draftState["vm-9"]).toBeDefined();
    expect(selectSelectedVmId(store.getState())).toBe("vm-2");
    expect(selectGuardOpen(store.getState())).toBe(false);
  });

  it("discard restores the saved assignment when there was one", () => {
    const store = createEditorStore();
    const saved = {
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load" as const,
      params: { duration: "600ms" },
    };
    store.setState({ currentVersionState: { "vm-1": saved }, draftState: { "vm-1": saved } });
    store.getState().setSelectedVmId("vm-1");
    store.getState().updateDraftParam("vm-1", "duration", "1200ms");
    store.getState().requestSelect("vm-2");

    store.getState().resolveGuard("discard");

    expect(store.getState().draftState["vm-1"]).toEqual(saved);
    expect(selectSelectedVmId(store.getState())).toBe("vm-2");
  });

  it("keep editing drops the pending selection and changes nothing else", () => {
    const store = dirtyWithPending();
    const draft = store.getState().draftState;

    store.getState().resolveGuard("keep");

    expect(store.getState().draftState).toBe(draft);
    expect(selectSelectedVmId(store.getState())).toBe("vm-1");
    expect(selectGuardOpen(store.getState())).toBe(false);
  });

  it("saved selects the pending element without touching the draft", () => {
    const store = dirtyWithPending();
    const draft = store.getState().draftState;

    store.getState().resolveGuard("saved");

    expect(store.getState().draftState).toBe(draft);
    expect(selectSelectedVmId(store.getState())).toBe("vm-2");
    expect(selectGuardOpen(store.getState())).toBe(false);
  });

  it("is a no-op when no guard is open", () => {
    const store = createEditorStore();
    store.getState().setSelectedVmId("vm-1");

    store.getState().resolveGuard("discard");

    expect(selectSelectedVmId(store.getState())).toBe("vm-1");
  });
});

describe("selectDirtyVmIds cost", () => {
  it("answers from cache while the two maps it compares are unchanged", () => {
    const store = createEditorStore();
    store.getState().setDraftAssignment("vm-1", assignmentFor("fade-in"));

    const first = selectDirtyVmIds(store.getState());
    expect(first).toEqual(["vm-1"]);

    // A hover report changes the state object but neither map. The panel has
    // three subscribers computing this on every store change, so recomputing
    // here means a Set, an array and a deep compare per hovered element, for
    // no reader (DT-126).
    store.getState().setHoverVmId("vm-9");
    expect(selectDirtyVmIds(store.getState())).toBe(first);

    store.getState().rememberElement({
      vmId: "vm-2",
      tag: "p",
      role: null,
      textPreview: "",
      rect: { x: 0, y: 0, width: 1, height: 1 },
      pageRect: { x: 0, y: 0, width: 1, height: 1 },
      order: 0,
      visible: true,
    });
    expect(selectDirtyVmIds(store.getState())).toBe(first);
  });

  it("recomputes as soon as either map moves", () => {
    const store = createEditorStore();
    store.getState().setDraftAssignment("vm-1", assignmentFor("fade-in"));
    const first = selectDirtyVmIds(store.getState());

    store.getState().setDraftAssignment("vm-2", assignmentFor("pulse"));
    const second = selectDirtyVmIds(store.getState());

    expect(second).not.toBe(first);
    expect([...second].sort()).toEqual(["vm-1", "vm-2"]);

    store.setState({ currentVersionState: { ...store.getState().draftState } });
    expect(selectDirtyVmIds(store.getState())).toEqual([]);
  });

  it("is still correct when two stores interleave", () => {
    const a = createEditorStore();
    const b = createEditorStore();
    a.getState().setDraftAssignment("vm-a", assignmentFor("fade-in"));
    b.getState().setDraftAssignment("vm-b", assignmentFor("pulse"));

    expect(selectDirtyVmIds(a.getState())).toEqual(["vm-a"]);
    expect(selectDirtyVmIds(b.getState())).toEqual(["vm-b"]);
    expect(selectDirtyVmIds(a.getState())).toEqual(["vm-a"]);
  });
});
