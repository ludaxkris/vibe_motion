import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialEditorState, useEditorStore } from "@/lib/store";

import { TuningPanel } from "./tuning";

// jsdom has no ResizeObserver and no real layout; Base UI's Select measures
// its popup with both. Stubbed here (test-only) so the popup can open — the
// production code has no knowledge of this.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
  useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
  useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
  useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

/**
 * Base UI's Select item commits a selection on the pointer sequence, not on
 * a bare `click` — jsdom's synthetic `click` alone leaves the value
 * unchanged. Test-only; production code never fires events itself.
 */
function selectOption(option: HTMLElement) {
  fireEvent.pointerDown(option);
  fireEvent.mouseDown(option);
  fireEvent.pointerUp(option);
  fireEvent.mouseUp(option);
  fireEvent.click(option);
}

describe("TuningPanel", () => {
  // jsdom has no layout, so Base UI's Slider cannot compute a thumb position:
  // the thumb (and its nested `<input type="range">`, the actual slider role)
  // stays `visibility: hidden` until it can. Per the accname spec a hidden
  // node's accessible name is "" even when `aria-label` is set and even when
  // the query includes hidden nodes — so these query the range input
  // directly by its param id instead of by accessible name.
  it("renders a slider for each duration/length/number/angle/percentage param, seeded from the draft", () => {
    const { container } = render(<TuningPanel vmId="vm-1" animationId="fade-in" />);

    // fade-in: duration (slider), delay (slider), easing (select).
    const durationSlider = container.querySelector<HTMLInputElement>(
      '#param-duration input[type="range"]',
    );
    expect(durationSlider).not.toBeNull();
    expect(durationSlider).toHaveAttribute("aria-valuenow", "600");
    expect(durationSlider).toHaveAttribute("aria-label", "duration");
  });

  it("dragging a slider (keyboard) updates the draft param, preserving the unit", () => {
    const { container } = render(<TuningPanel vmId="vm-1" animationId="fade-in" />);

    const durationSlider = container.querySelector<HTMLInputElement>(
      '#param-duration input[type="range"]',
    )!;
    durationSlider.focus();
    fireEvent.keyDown(durationSlider, { key: "ArrowRight" });

    const state = useEditorStore.getState();
    expect(state.draftState["vm-1"].params.duration).not.toBe("600ms");
    expect(state.draftState["vm-1"].params.duration.endsWith("ms")).toBe(true);
  });

  it("changing the trigger select writes to the draft", () => {
    render(<TuningPanel vmId="vm-1" animationId="fade-in" />);

    fireEvent.click(screen.getByRole("combobox", { name: /trigger/i }));
    const listbox = screen.getByRole("listbox");
    selectOption(within(listbox).getByRole("option", { name: "in-view" }));

    expect(useEditorStore.getState().draftState["vm-1"].trigger).toBe("in-view");
  });

  it("Back dispatches BACK, returning to choosing and keeping the draft", () => {
    render(<TuningPanel vmId="vm-1" animationId="fade-in" />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "choosing", vmId: "vm-1" });
    expect(state.draftState["vm-1"]).toBeDefined();
  });

  it("Remove drops the draft assignment and dispatches CLEAR, returning to selected", () => {
    render(<TuningPanel vmId="vm-1" animationId="fade-in" />);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    const state = useEditorStore.getState();
    expect(state.panel).toEqual({ status: "selected", vmId: "vm-1" });
    expect(state.draftState["vm-1"]).toBeUndefined();
  });

  it("renders a color input for color params (glow's Glow color)", () => {
    useEditorStore.getState().dispatchPanel({ type: "BACK" });
    useEditorStore.getState().dispatchPanel({ type: "BACK" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "glow" });

    render(<TuningPanel vmId="vm-1" animationId="glow" />);

    const colorInput = screen.getByLabelText("Glow color");
    expect(colorInput).toHaveValue("rgba(99, 102, 241, 0.6)");

    fireEvent.change(colorInput, { target: { value: "#ff0000" } });
    expect(useEditorStore.getState().draftState["vm-1"].params.color).toBe("#ff0000");
  });
});
