import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_CATALOG_VERSION, defaultAssignmentFor, getCatalogEntry } from "@/lib/catalog";
import { initialEditorState, useEditorStore } from "@/lib/store";

import { ControlPanel } from "./index";

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("ControlPanel", () => {
  it("renders the idle panel when nothing is selected", () => {
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-idle")).toBeInTheDocument();
  });

  it("renders the selected panel once an element is selected", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-selected")).toBeInTheDocument();
  });

  it("renders the choosing panel", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-choosing")).toBeInTheDocument();
  });

  it("renders the tuning panel", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
  });

  it("wires the idle panel's rows to the selection, landing on tuning", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    useEditorStore.getState().dispatchPanel({ type: "DESELECT" });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Fade In on vm-1/ }));

    expect(useEditorStore.getState().panel).toEqual({
      status: "tuning",
      vmId: "vm-1",
      animationId: "fade-in",
    });
  });

  it("Change then ‹ comes back to tuning, not to 'No animation yet'", () => {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByTestId("panel-choosing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(screen.queryByText(/No animation yet/)).not.toBeInTheDocument();
  });

  it("re-picking the card already applied keeps what was tuned", () => {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in" });
    store.updateDraftParam("vm-1", "duration", "900ms");
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Fade In" }));

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(useEditorStore.getState().draftState["vm-1"].params.duration).toBe("900ms");
  });

  it("carries the handoff's three folder tabs, Animate first", () => {
    render(<ControlPanel />);

    expect(screen.getByRole("tab", { name: "Animate" })).toHaveAttribute("data-active");
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Export" })).toBeInTheDocument();
  });

  it("gives History and Export a caption each until their phases land", () => {
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText(/only created when you click Save/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));
    expect(screen.getByText("Export arrives with Phase 7.")).toBeInTheDocument();
  });

  it("keeps the caption pointing at the top bar for Save and Cancel", () => {
    render(<ControlPanel />);

    expect(screen.getByText(/Save and Cancel live in the top bar/)).toBeInTheDocument();
  });
});

describe("ControlPanel · pinned catalog version", () => {
  /** A draft assignment on `vm-1` pinned to `catalogVersion`, mid-tuning. */
  function tuningPinnedTo(catalogVersion: string, animationId = "fade-in") {
    useEditorStore.setState({
      panel: { status: "tuning", vmId: "vm-1", animationId },
      draftState: {
        "vm-1": {
          animationId,
          catalogVersion,
          trigger: "load",
          params: { duration: "600ms", delay: "0ms", easing: "ease-out" },
        },
      },
    });
  }

  it("tunes a 1.0.0 assignment against 1.0.0, which has no fill mode", () => {
    tuningPinnedTo("1.0.0");
    render(<ControlPanel />);

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    // `fillMode` arrived in 1.1.0; offering it here would write a param the
    // pinned version cannot validate.
    expect(screen.queryByText("Fill mode")).not.toBeInTheDocument();
  });

  it("tunes a current-version assignment against the current catalog", () => {
    tuningPinnedTo(CURRENT_CATALOG_VERSION);
    render(<ControlPanel />);

    expect(screen.getByText("Fill mode")).toBeInTheDocument();
  });

  it("says so when the pinned version has no such entry", () => {
    tuningPinnedTo("9.9.9");
    render(<ControlPanel />);

    expect(screen.getByTestId("panel-tuning-missing-entry")).toBeInTheDocument();
  });

  it("names the guarded animation from the version the assignment pinned", () => {
    useEditorStore.setState({
      panel: { status: "tuning", vmId: "vm-1", animationId: "fade-in" },
      draftState: {
        "vm-1": {
          animationId: "fade-in",
          catalogVersion: "9.9.9",
          trigger: "load",
          params: {},
        },
      },
    });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes to vm-1?" });
    // No 9.9.9 catalog to name it from, so the id stands in — rather than the
    // current catalog's name for an entry this assignment never used.
    expect(within(dialog).getByText("fade-in")).toBeInTheDocument();
  });
});

describe("ControlPanel · unsaved guard", () => {
  /** Puts a draft assignment on `vm-1` that the saved version does not have. */
  function makeDirty() {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
  }

  it("keeps the inactive folder tabs faint while there are unsaved changes", () => {
    makeDirty();
    render(<ControlPanel />);

    expect(screen.getByRole("tab", { name: "History" })).toHaveClass("text-vm-ink-4");
    expect(screen.getByRole("tab", { name: "Animate" })).not.toHaveClass("text-vm-ink-4");
  });

  it("leaves the tabs alone while the draft is clean", () => {
    render(<ControlPanel />);

    expect(screen.getByRole("tab", { name: "History" })).not.toHaveClass("text-vm-ink-4");
  });

  it("asks before leaving the tab, naming the element and its animation", () => {
    makeDirty();
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes to vm-1?" });
    expect(within(dialog).getByText("Fade In Up")).toBeInTheDocument();
    expect(within(dialog).getByText(/discard to leave v5 as is/)).toBeInTheDocument();
    // The switch has not happened: Animate's body is still the one behind the
    // modal. (By role it is unreachable — the open dialog inerts the page —
    // so this asks the DOM rather than the accessibility tree.)
    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
  });

  it("names the element only when a discard would take nothing else with it", () => {
    makeDirty();
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const dialog = screen.getByRole("dialog", { name: "Save changes to vm-1?" });
    expect(within(dialog).getByText("Fade In Up")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("counts the elements instead of naming one when two have unsaved changes", () => {
    // The reviewer's repro: animate vm-1, then animate vm-2 and leave vm-2
    // selected. "Save changes to vm-2?" would point at one of the two things
    // Discard is about to throw away.
    makeDirty();
    const store = useEditorStore.getState();
    store.setSelectedVmId("vm-2");
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "pulse" });
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes?" });
    expect(
      within(dialog).getByText(/You have unsaved changes on 2 elements\./),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("Pulse")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    // Both of them, which is exactly what the copy said.
    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("asks generically when the unsaved work is on some other element", () => {
    makeDirty();
    // The selection moves to an element that is exactly as it was saved
    // (namely: with nothing on it). Naming it would be a lie.
    useEditorStore.getState().setSelectedVmId("vm-2");
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes?" });
    expect(within(dialog).getByText(/You have unsaved changes/)).toBeInTheDocument();
    expect(within(dialog).queryByText("Fade In Up")).not.toBeInTheDocument();
  });

  it("guards the Export tab too", () => {
    makeDirty();
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    expect(screen.getByRole("dialog", { name: "Save changes to vm-1?" })).toBeInTheDocument();
    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("data-active");
    expect(screen.getByText("Export arrives with Phase 7.")).toBeInTheDocument();
  });

  it("discards the draft and then makes the switch", () => {
    makeDirty();
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(useEditorStore.getState().draftState).toEqual({});
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("data-active");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the edit and the tab on Keep editing", () => {
    makeDirty();
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(useEditorStore.getState().draftState["vm-1"]).toBeDefined();
    expect(screen.getByRole("tab", { name: "Animate" })).toHaveAttribute("data-active");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never offers a save it cannot perform", () => {
    makeDirty();
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Saving arrives with version history.")).toBeInTheDocument();
  });

  it("switches straight away once the draft is clean again", () => {
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("data-active");
  });
});

describe("ControlPanel bridge seams", () => {
  function choosing() {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
  }

  it("previews exactly what picking the hovered card would apply", () => {
    const onPreview = vi.fn();
    const onClearPreview = vi.fn();
    choosing();
    render(<ControlPanel onPreview={onPreview} onClearPreview={onClearPreview} />);

    const card = screen.getByRole("button", { name: "Fade In Up" });
    fireEvent.mouseEnter(card);

    expect(onPreview).toHaveBeenCalledWith("vm-1", {
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: expect.objectContaining({ duration: expect.any(String) }),
    });
    // …and it stays a preview: the draft is untouched (CLAUDE.md rule 9).
    expect(useEditorStore.getState().draftState).toEqual({});

    fireEvent.mouseLeave(card);
    expect(onClearPreview).toHaveBeenCalledOnce();
  });

  it("ends the preview when the picker goes away, whatever took it away", () => {
    const onClearPreview = vi.fn();
    choosing();
    const view = render(<ControlPanel onPreview={vi.fn()} onClearPreview={onClearPreview} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));
    // A pick unmounts the grid under the pointer, so the card never gets its
    // `mouseleave` — and a preview left behind would sit on top of every
    // later apply (spec D6).
    fireEvent.click(screen.getByRole("button", { name: "Fade In Up" }));

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(onClearPreview).toHaveBeenCalled();

    onClearPreview.mockClear();
    view.unmount();
  });

  it("ends the preview when the element is deselected out from under the picker", () => {
    const onClearPreview = vi.fn();
    choosing();
    render(<ControlPanel onPreview={vi.fn()} onClearPreview={onClearPreview} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));

    act(() => {
      useEditorStore.getState().dispatchPanel({ type: "DESELECT" });
    });

    expect(onClearPreview).toHaveBeenCalled();
  });

  it("previews the element's own tuned assignment for the card already applied", () => {
    const onPreview = vi.fn();
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    act(() => {
      useEditorStore.getState().updateDraftParam("vm-1", "duration", "1200ms");
    });
    // Back into the picker with that animation applied and tuned.
    act(() => {
      useEditorStore.getState().dispatchPanel({ type: "BACK" });
    });
    render(<ControlPanel onPreview={onPreview} onClearPreview={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));

    // Clicking that card keeps the tuned value (the store's PICK says so), so
    // hovering it must not snap the element back to the catalog default.
    expect(onPreview).toHaveBeenCalledWith(
      "vm-1",
      expect.objectContaining({ params: expect.objectContaining({ duration: "1200ms" }) }),
    );
  });

  it("previews catalog defaults for a card that is not the applied one", () => {
    const onPreview = vi.fn();
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    act(() => {
      useEditorStore.getState().updateDraftParam("vm-1", "duration", "1200ms");
      useEditorStore.getState().dispatchPanel({ type: "BACK" });
    });
    render(<ControlPanel onPreview={onPreview} onClearPreview={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Pulse" }));

    // The catalog's own defaults for `pulse`, not the tuned `fade-in-up` ones.
    expect(onPreview).toHaveBeenCalledWith("vm-1", defaultAssignmentFor(getCatalogEntry("pulse")!));
  });

  it("leaves the picker inert when there is no bridge to preview on", () => {
    choosing();
    render(<ControlPanel />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));

    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("replays the element being tuned, and again when a slider is released", () => {
    const onReplay = vi.fn();
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel onReplay={onReplay} />);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledWith("vm-1");

    const slider = screen.getByLabelText("Duration");
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });

    expect(onReplay).toHaveBeenCalledTimes(2);
    expect(useEditorStore.getState().draftState["vm-1"]?.params.duration).toBe("650ms");
  });

  it("keeps Replay disabled while no bridge is mounted", () => {
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel />);

    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
  });
});
