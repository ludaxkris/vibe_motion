import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SelectedPanel } from "./selected";

describe("SelectedPanel", () => {
  it("names the selected element and says it has no animation yet", () => {
    render(<SelectedPanel vmId="vm-42" />);

    expect(screen.getByTestId("panel-selected")).toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText("vm-42")).toBeInTheDocument();
    expect(screen.getByText("No animation yet · Esc to deselect")).toBeInTheDocument();
  });

  it("shows the element's own text beside the tag when the bridge supplies it", () => {
    render(<SelectedPanel vmId="vm-42" elementText="Ship faster with Nimbus" />);

    expect(screen.getByText("Ship faster with Nimbus")).toBeInTheDocument();
  });

  it("offers auto-generate (still to come) and the custom picker", () => {
    render(<SelectedPanel vmId="vm-42" />);

    expect(screen.getByText("Add animation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Auto-generate for this element" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose custom animation" })).toBeEnabled();
  });

  it("asks for the picker when Choose custom animation is clicked", () => {
    const onChooseCustom = vi.fn();
    render(<SelectedPanel vmId="vm-42" onChooseCustom={onChooseCustom} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose custom animation" }));

    expect(onChooseCustom).toHaveBeenCalledOnce();
  });
});
