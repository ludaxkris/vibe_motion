import { beforeEach, describe, expect, it } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntry } from "@/lib/catalog";
import { resolveParams } from "@/lib/runtime-css";
import type { CatalogEntry as CatalogPackageEntry } from "animation-catalog";

import { initialEditorState, useEditorStore } from "./index";

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("useEditorStore panel/draft integration", () => {
  it("starts idle with no selection and clean draft", () => {
    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "idle" });
    expect(state.selectedVmId).toBeNull();
    expect(state.unsaved).toBe(false);
  });

  it("setSelectedVmId dispatches SELECT and keeps selectedVmId in sync", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "selected", vmId: "vm-1" });
    expect(state.selectedVmId).toBe("vm-1");
  });

  it("setSelectedVmId(null) dispatches DESELECT", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().setSelectedVmId(null);
    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "idle" });
    expect(state.selectedVmId).toBeNull();
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
      params: resolveParams(entry as unknown as CatalogPackageEntry),
    });
    expect(state.unsaved).toBe(true);
    expect(state.panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });
  });

  it("updateDraftParam merges one param and keeps unsaved true", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().updateDraftParam("vm-1", "duration", "900ms");

    const state = useEditorStore.getState();
    expect(state.draftState["vm-1"].params.duration).toBe("900ms");
    expect(state.unsaved).toBe(true);
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
    expect(useEditorStore.getState().unsaved).toBe(true);

    useEditorStore.getState().removeDraftAssignment("vm-1");

    const state = useEditorStore.getState();
    expect(state.draftState["vm-1"]).toBeUndefined();
    expect(state.unsaved).toBe(false);
  });

  it("unsaved reflects a deep comparison against currentVersionState, not identity", () => {
    const entry = getCatalogEntry("fade-in")!;
    const assignment = {
      animationId: "fade-in",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger!,
      params: resolveParams(entry as unknown as CatalogPackageEntry),
    };
    useEditorStore.setState({
      currentVersionState: { "vm-1": assignment },
    });

    // A structurally-identical but distinct object assigned to the draft
    // must not be flagged unsaved.
    useEditorStore.getState().setDraftAssignment("vm-1", { ...assignment, params: { ...assignment.params } });
    expect(useEditorStore.getState().unsaved).toBe(false);

    useEditorStore.getState().updateDraftParam("vm-1", "duration", "1200ms");
    expect(useEditorStore.getState().unsaved).toBe(true);
  });

  it("reset restores the initial state", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    useEditorStore.getState().reset();

    expect(useEditorStore.getState()).toMatchObject(initialEditorState);
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
});
