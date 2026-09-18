import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

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
