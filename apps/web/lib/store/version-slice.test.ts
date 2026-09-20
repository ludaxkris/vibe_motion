/**
 * Store wiring for `lib/versions/transitions.ts`'s pure functions: each
 * `EditorActions` writer applies the matching transition to the slice read
 * from `get()`, replaces the draft wholesale where the transition does, and
 * keeps the guard and the Control Panel in sync with the new draft the same
 * way `revertDraft` does today.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import type { EditorStateMap, Version } from "@/lib/api-client";

import {
  createEditorStore,
  initialEditorState,
  selectDirtyVmIdCount,
  selectGuardedVmId,
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

function version(overrides: Partial<Version> = {}): Version {
  return {
    id: "version-2",
    projectId: "project-1",
    parentVersionId: "version-1",
    seq: 2,
    label: "v2",
    catalogVersion: CURRENT_CATALOG_VERSION,
    diff: { set: {}, remove: [] },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("loadVersion", () => {
  it("replaces both maps, sets currentVersionId and clears viewingVersionId", () => {
    const state: EditorStateMap = { "vm-1": assignmentFor("fade-in") };

    useEditorStore.getState().loadVersion("version-1", state);

    const after = useEditorStore.getState();
    expect(after.draftState).toEqual(state);
    expect(after.currentVersionState).toEqual(state);
    expect(after.mode).toBe("editing");
    expect(after.currentVersionId).toBe("version-1");
    expect(after.viewingVersionId).toBeNull();
    expect(selectUnsaved(after)).toBe(false);
  });

  it("closes an open element-switch guard", () => {
    const store = createEditorStore();
    store.getState().setSelectedVmId("vm-1");
    store.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    store.getState().requestSelect("vm-2");
    expect(store.getState().pendingSelectVmId).toBe("vm-2");

    store.getState().loadVersion("version-1", {});

    expect(store.getState().pendingSelectVmId).toBeNull();
    expect(store.getState().guardedVmId).toBeNull();
  });
});

describe("markSaved", () => {
  it("clears unsaved and moves currentVersionId, leaving the panel alone", () => {
    useEditorStore.getState().setSelectedVmId("vm-1");
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    const panelBefore = useEditorStore.getState().panel;
    expect(selectUnsaved(useEditorStore.getState())).toBe(true);

    useEditorStore.getState().markSaved(version({ id: "version-9" }));

    const after = useEditorStore.getState();
    expect(selectUnsaved(after)).toBe(false);
    expect(after.currentVersionId).toBe("version-9");
    expect(after.panel).toBe(panelBefore);
  });

  it("throws while viewing", () => {
    const store = createEditorStore();
    store.getState().loadVersion("version-1", {});
    store.getState().enterViewing("version-0", {});

    expect(() => store.getState().markSaved(version())).toThrow();
  });
});

describe("enterViewing / exitViewing", () => {
  it("enterViewing on a clean store moves to a read-only view of the given state", () => {
    const store = createEditorStore();
    const current: EditorStateMap = { "vm-1": assignmentFor("fade-in") };
    store.getState().loadVersion("version-1", current);
    const viewed: EditorStateMap = { "vm-1": assignmentFor("pulse") };

    store.getState().enterViewing("version-0", viewed);

    const state = store.getState();
    expect(state.mode).toBe("viewing");
    expect(state.viewingVersionId).toBe("version-0");
    expect(state.draftState).toEqual(viewed);
    expect(state.currentVersionState).toEqual(current);
    expect(selectUnsaved(state)).toBe(false);
    expect(selectDirtyVmIdCount(state)).toBe(0);
    expect(selectGuardedVmId(state)).toBeNull();
  });

  it("throws when the draft is dirty", () => {
    const store = createEditorStore();
    store.getState().setSelectedVmId("vm-1");
    store.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });

    expect(() => store.getState().enterViewing("version-0", {})).toThrow();
  });

  it("exitViewing returns to editing with the draft equal to currentVersionState", () => {
    const store = createEditorStore();
    const current: EditorStateMap = { "vm-1": assignmentFor("fade-in") };
    store.getState().loadVersion("version-1", current);
    store.getState().enterViewing("version-0", { "vm-1": assignmentFor("pulse") });

    store.getState().exitViewing();

    const state = store.getState();
    expect(state.mode).toBe("editing");
    expect(state.viewingVersionId).toBeNull();
    expect(state.draftState).toEqual(current);
  });

  it("panel follows the draft across enter/exit viewing", () => {
    const store = createEditorStore();
    const current: EditorStateMap = { "vm-1": assignmentFor("fade-in") };
    store.getState().loadVersion("version-1", current);
    store.getState().setSelectedVmId("vm-1");
    expect(store.getState().panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });

    store.getState().enterViewing("version-0", {});

    expect(store.getState().panel).toEqual({ status: "selected", vmId: "vm-1" });
    expect(selectSelectedVmId(store.getState())).toBe("vm-1");

    store.getState().exitViewing();

    expect(store.getState().panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });
    expect(selectSelectedVmId(store.getState())).toBe("vm-1");
  });
});

describe("while viewing, the store is read-only", () => {
  function viewingStore() {
    const store = createEditorStore();
    store.getState().loadVersion("version-1", { "vm-1": assignmentFor("fade-in") });
    store.getState().setSelectedVmId("vm-1");
    store.getState().enterViewing("version-0", {});
    return store;
  }

  it("updateDraftParam is a no-op", () => {
    const store = viewingStore();
    const before = store.getState();
    store.getState().updateDraftParam("vm-1", "duration", "900ms");
    expect(store.getState()).toEqual(before);
  });

  it("setDraftAssignment is a no-op", () => {
    const store = viewingStore();
    const before = store.getState();
    store.getState().setDraftAssignment("vm-2", assignmentFor("pulse"));
    expect(store.getState()).toEqual(before);
  });

  it("removeDraftAssignment is a no-op", () => {
    const store = viewingStore();
    const before = store.getState();
    store.getState().removeDraftAssignment("vm-1");
    expect(store.getState()).toEqual(before);
  });

  it("revertDraft is a no-op", () => {
    const store = viewingStore();
    const before = store.getState();
    store.getState().revertDraft();
    expect(store.getState()).toEqual(before);
  });

  it("requestSelect is a no-op", () => {
    const store = viewingStore();
    const before = store.getState();
    store.getState().requestSelect("vm-2");
    expect(store.getState()).toEqual(before);
  });

  it("dispatchPanel PICK is a no-op, but other panel events still work", () => {
    const store = viewingStore();
    const before = store.getState();

    store.getState().dispatchPanel({ type: "PICK", animationId: "pulse" });
    expect(store.getState()).toEqual(before);

    store.getState().dispatchPanel({ type: "DESELECT" });
    expect(store.getState().panel).toEqual({ status: "idle" });
  });

  it("markSaved throws", () => {
    const store = viewingStore();
    expect(() => store.getState().markSaved(version())).toThrow();
  });
});

describe("rebaseDraft", () => {
  it("replays my change on the newer state and moves currentVersionId", () => {
    const store = createEditorStore();
    const original: EditorStateMap = { "vm-1": assignmentFor("fade-in") };
    store.getState().loadVersion("version-1", original);
    store.getState().updateDraftParam("vm-1", "duration", "900ms");

    const newerFromServer: EditorStateMap = { "vm-2": assignmentFor("pulse") };

    store.getState().rebaseDraft("version-2", newerFromServer);

    const state = store.getState();
    expect(state.currentVersionId).toBe("version-2");
    expect(state.currentVersionState).toEqual(newerFromServer);
    expect(state.draftState["vm-1"].params.duration).toBe("900ms");
    expect(state.draftState["vm-2"]).toEqual(newerFromServer["vm-2"]);
    expect(selectUnsaved(state)).toBe(true);
  });
});

describe("reset", () => {
  it("clears currentVersionId and viewingVersionId", () => {
    const store = createEditorStore();
    store.getState().loadVersion("version-1", {});
    store.getState().enterViewing("version-0", {});

    store.getState().reset();

    expect(store.getState().currentVersionId).toBeNull();
    expect(store.getState().viewingVersionId).toBeNull();
    expect(store.getState().mode).toBe("editing");
  });
});
