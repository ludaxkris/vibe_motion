import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { initialEditorState, useEditorStore } from "@/lib/store";

import { SelectedPanel } from "./selected";

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("SelectedPanel", () => {
  it("shows the selected element", () => {
    render(<SelectedPanel vmId="vm-42" />);
    expect(screen.getByText("vm-42")).toBeInTheDocument();
  });

  it("Generate is disabled with a visible hint, since it arrives in Phase 5", () => {
    render(<SelectedPanel vmId="vm-42" />);
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    expect(screen.getByText(/arrives in phase 5/i)).toBeInTheDocument();
  });

  it("Custom dispatches CHOOSE_CUSTOM, moving the panel to choosing", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-42" });
    render(<SelectedPanel vmId="vm-42" />);

    fireEvent.click(screen.getByRole("button", { name: "Custom" }));

    expect(useEditorStore.getState().panel).toEqual({ status: "choosing", vmId: "vm-42" });
  });
});
