import { fireEvent, render, screen } from "@testing-library/react";
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
