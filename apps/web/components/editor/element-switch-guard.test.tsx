import type { ElementInfo } from "bridge";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import { initialEditorState, selectSelectedVmId, useEditorStore } from "@/lib/store";

import { ElementSwitchGuard } from "./element-switch-guard";

function elementInfo(vmId: string, tag: string): ElementInfo {
  return {
    vmId,
    tag,
    role: null,
    textPreview: "",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    pageRect: { x: 0, y: 0, width: 10, height: 10 },
    order: 0,
    visible: true,
  };
}

function assignmentFor(animationId: string) {
  const entry = getCatalogEntry(animationId)!;
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  };
}

/** `vm-1` selected, animated and unsaved, with a pending switch to `vm-2`. */
function openGuard(animationId = "fade-in-up") {
  const store = useEditorStore.getState();
  store.rememberElement(elementInfo("vm-1", "h1"));
  store.setSelectedVmId("vm-1");
  store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
  store.dispatchPanel({ type: "PICK", animationId });
  useEditorStore.getState().requestSelect("vm-2");
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

afterEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("ElementSwitchGuard", () => {
  it("stays closed while nothing is pending", () => {
    render(<ElementSwitchGuard />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the element by the tag the bridge reported, and the animation on it", () => {
    openGuard();

    render(<ElementSwitchGuard currentVersionLabel="v5" />);

    expect(screen.getByText("Save changes to h1?")).toBeInTheDocument();
    expect(screen.getByText("Fade In Up")).toBeInTheDocument();
    expect(screen.getByText(/discard to leave v5 as is/)).toBeInTheDocument();
  });

  it("falls back to the vmId when the bridge has told us nothing about the element", () => {
    const store = useEditorStore.getState();
    store.setSelectedVmId("vm-9");
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    useEditorStore.getState().requestSelect("vm-2");

    render(<ElementSwitchGuard />);

    expect(screen.getByText("Save changes to vm-9?")).toBeInTheDocument();
  });

  it("Discard reverts that one element and lets the pending selection through", () => {
    const saved = assignmentFor("pulse");
    useEditorStore.setState({
      currentVersionState: { "vm-1": saved, "vm-3": saved },
      draftState: { "vm-1": saved, "vm-3": saved },
    });
    const store = useEditorStore.getState();
    store.rememberElement(elementInfo("vm-1", "h1"));
    // Lands on `tuning` for the saved animation; changing it there is what
    // makes this element — and only this one — dirty.
    store.setSelectedVmId("vm-1");
    store.setDraftAssignment("vm-1", assignmentFor("shake"));
    useEditorStore.getState().requestSelect("vm-2");

    render(<ElementSwitchGuard />);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    const state = useEditorStore.getState();
    expect(state.draftState["vm-1"]).toEqual(saved);
    // Only the element the question named: the other one's draft is untouched.
    expect(state.draftState["vm-3"]).toEqual(saved);
    expect(selectSelectedVmId(state)).toBe("vm-2");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Keep editing drops the pending selection and changes nothing else", () => {
    openGuard();
    const before = useEditorStore.getState().draftState;

    render(<ElementSwitchGuard />);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    const state = useEditorStore.getState();
    expect(state.draftState).toBe(before);
    expect(selectSelectedVmId(state)).toBe("vm-1");
    expect(state.pendingSelectVmId).toBeNull();
  });

  it("dismissing the dialog with Escape is Keep editing", () => {
    openGuard();

    render(<ElementSwitchGuard />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    return waitFor(() => {
      const state = useEditorStore.getState();
      expect(selectSelectedVmId(state)).toBe("vm-1");
      expect(state.pendingSelectVmId).toBeNull();
    });
  });

  it("renders Save disabled, and says why, while version history does not exist", () => {
    openGuard();

    render(<ElementSwitchGuard />);

    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute("title", "Saving arrives with version history.");
    expect(screen.getByText("Saving arrives with version history.")).toBeInTheDocument();
  });

  it("awaits the injected Save and only then lets the pending selection through", async () => {
    openGuard();
    let release!: () => void;
    const saving = new Promise<void>((resolve) => {
      release = resolve;
    });
    const onSave = vi.fn(() => saving);

    render(<ElementSwitchGuard onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledOnce();
    // Still on the element being saved, and the draft is untouched.
    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-1");

    release();
    await waitFor(() => {
      expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-2");
    });
    expect(useEditorStore.getState().draftState["vm-1"]).toBeDefined();
  });

  it("keeps the guard open when the injected Save fails", async () => {
    openGuard();
    const onSave = vi.fn(() => Promise.reject(new Error("nope")));

    render(<ElementSwitchGuard onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
    await waitFor(() => {
      expect(useEditorStore.getState().pendingSelectVmId).toBe("vm-2");
    });
    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-1");
  });
});

describe("ElementSwitchGuard copy", () => {
  it("asks the generic, counted question when more than one element is dirty", () => {
    const store = useEditorStore.getState();
    store.rememberElement(elementInfo("vm-1", "h1"));
    store.setDraftAssignment("vm-1", assignmentFor("fade-in-up"));
    store.setDraftAssignment("vm-2", assignmentFor("pulse"));
    store.setSelectedVmId("vm-1");
    useEditorStore.getState().requestSelect("vm-3");

    render(<ElementSwitchGuard currentVersionLabel="v5" />);

    // Naming one element while two are unsaved would describe a smaller loss
    // than the page is carrying.
    expect(screen.getByText("Save changes?")).toBeInTheDocument();
    expect(screen.getByText(/unsaved changes on 2 elements/)).toBeInTheDocument();
    expect(screen.queryByText("Save changes to h1?")).not.toBeInTheDocument();
  });

  it("names the element the guard was opened about, even after the selection moves", () => {
    const store = useEditorStore.getState();
    store.rememberElement(elementInfo("vm-1", "h1"));
    store.setDraftAssignment("vm-1", assignmentFor("fade-in-up"));
    store.setSelectedVmId("vm-1");
    useEditorStore.getState().requestSelect("vm-2");

    render(<ElementSwitchGuard />);
    expect(screen.getByText("Save changes to h1?")).toBeInTheDocument();

    // A programmatic move (Phase 5 result rows, Phase 6 version load) closes
    // the guard rather than leaving it pointing at the wrong element.
    act(() => {
      useEditorStore.getState().setSelectedVmId("vm-9");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
