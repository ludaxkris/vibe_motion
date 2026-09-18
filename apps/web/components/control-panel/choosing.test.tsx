import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { getCatalogEntries } from "@/lib/catalog";
import { initialEditorState, useEditorStore } from "@/lib/store";

import { ChoosingPanel } from "./choosing";

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
  useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
  useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
});

describe("ChoosingPanel", () => {
  it("lists every current-catalog entry, grouped by category", () => {
    render(<ChoosingPanel vmId="vm-1" />);
    const entries = getCatalogEntries();
    for (const entry of entries) {
      expect(screen.getByRole("button", { name: entry.name })).toBeInTheDocument();
    }
  });

  it("filters the list by name", () => {
    render(<ChoosingPanel vmId="vm-1" />);

    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "fade in" } });

    expect(screen.getByRole("button", { name: "Fade In" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spin" })).not.toBeInTheDocument();
  });

  it("shows a no-match message when the filter matches nothing", () => {
    render(<ChoosingPanel vmId="vm-1" />);

    fireEvent.change(screen.getByLabelText("Filter"), { target: { value: "zzzz" } });

    expect(screen.getByText(/no animations match/i)).toBeInTheDocument();
  });

  it("picking an entry dispatches PICK and creates the draft assignment", () => {
    render(<ChoosingPanel vmId="vm-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Fade In" }));

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "fade-in" });
    expect(state.draftState["vm-1"].animationId).toBe("fade-in");
  });

  it("Back dispatches BACK, returning to selected", () => {
    render(<ChoosingPanel vmId="vm-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(useEditorStore.getState().panel).toEqual({ status: "selected", vmId: "vm-1" });
  });
});
