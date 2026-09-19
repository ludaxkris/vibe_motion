import { beforeEach, describe, expect, it } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";

import {
  initialEditorState,
  selectSelectedElementUnsaved,
  selectSelectedVmId,
  selectUnsaved,
  useEditorStore,
} from "./index";

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

describe("selectSelectedElementUnsaved", () => {
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

  it("is false when nothing is selected, however dirty the draft is", () => {
    useEditorStore.getState().setDraftAssignment("vm-1", {
      animationId: "fade-in",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    });
    const state = useEditorStore.getState();

    expect(selectUnsaved(state)).toBe(true);
    expect(selectSelectedElementUnsaved(state)).toBe(false);
  });

  it("is false for a selected element whose own assignment is untouched", () => {
    withSavedAssignment("vm-1", "fade-in-up");
    // Another element is what changed.
    useEditorStore.getState().setDraftAssignment("vm-2", {
      animationId: "pulse",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    });
    useEditorStore.getState().setSelectedVmId("vm-1");
    const state = useEditorStore.getState();

    expect(selectUnsaved(state)).toBe(true);
    expect(selectSelectedElementUnsaved(state)).toBe(false);
  });

  it("is true once the selected element's own params move", () => {
    withSavedAssignment("vm-1", "fade-in-up");
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().updateDraftParam("vm-1", "duration", "800ms");

    expect(selectSelectedElementUnsaved(useEditorStore.getState())).toBe(true);
  });

  it("is true for a selected element that has only just been given an animation", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });

    expect(selectSelectedElementUnsaved(useEditorStore.getState())).toBe(true);
  });

  it("is true for a selected element whose animation was removed from the draft", () => {
    withSavedAssignment("vm-1", "fade-in-up");
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().removeDraftAssignment("vm-1");

    expect(selectSelectedElementUnsaved(useEditorStore.getState())).toBe(true);
  });
});
