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

  it("offers auto-generate and the custom picker; auto-generate is disabled with nothing to run it", () => {
    render(<SelectedPanel vmId="vm-42" />);

    expect(screen.getByText("Add animation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Auto-generate for this element" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Choose custom animation" })).toBeEnabled();
  });

  it("generates for the element on click", () => {
    const onGenerate = vi.fn();
    render(<SelectedPanel vmId="vm-42" onGenerate={onGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: "Auto-generate for this element" }));

    expect(onGenerate).toHaveBeenCalledOnce();
  });

  it("shows a busy, disabled button while a run is in flight", () => {
    const onGenerate = vi.fn();
    render(<SelectedPanel vmId="vm-42" onGenerate={onGenerate} busy />);

    const button = screen.getByRole("button", { name: "Generating…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    // The picker stays available: choosing by hand needs no agent.
    expect(screen.getByRole("button", { name: "Choose custom animation" })).toBeEnabled();
  });

  it("keeps one live region mounted: empty, then busy, then the failure", () => {
    const { rerender } = render(<SelectedPanel vmId="vm-42" onGenerate={() => undefined} />);
    const region = screen.getByRole("status");
    expect(region).toBeEmptyDOMElement();

    rerender(<SelectedPanel vmId="vm-42" onGenerate={() => undefined} busy />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Generating…");

    rerender(<SelectedPanel vmId="vm-42" onGenerate={() => undefined} error="agent-failed" />);
    expect(screen.getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("Couldn't read the page. Try again.");
  });

  it("says why a run failed, under the button", () => {
    render(<SelectedPanel vmId="vm-42" onGenerate={() => undefined} error="agent-failed" />);

    expect(screen.getByRole("status")).toHaveTextContent("Couldn't read the page. Try again.");
  });

  it("asks for the picker when Choose custom animation is clicked", () => {
    const onChooseCustom = vi.fn();
    render(<SelectedPanel vmId="vm-42" onChooseCustom={onChooseCustom} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose custom animation" }));

    expect(onChooseCustom).toHaveBeenCalledOnce();
  });

  it("has no ‹ control unless it was given somewhere to go back to", () => {
    render(<SelectedPanel vmId="vm-42" />);

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("says Esc returns to the list when opened from it, since that is what Esc does there", () => {
    render(<SelectedPanel vmId="vm-42" onBack={() => undefined} />);

    expect(screen.getByText("No animation yet · Esc returns to the list")).toBeInTheDocument();
    expect(screen.queryByText(/Esc to deselect/)).not.toBeInTheDocument();
  });

  it("shows ‹ when onBack is passed, and calls it", () => {
    const onBack = vi.fn();
    render(<SelectedPanel vmId="vm-42" onBack={onBack} />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
  });
});
