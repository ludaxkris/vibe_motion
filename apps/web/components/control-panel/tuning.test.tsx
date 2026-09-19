import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Assignment, CatalogEntry } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import { easingCurvePath } from "@/lib/easing-curve";

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

function entryFor(animationId: string): CatalogEntry {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`no catalog entry ${animationId}`);
  return entry;
}

function assignmentFor(entry: CatalogEntry, params?: Record<string, string>): Assignment {
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: entry.defaultTrigger ?? entry.triggers[0],
    params: { ...resolveCatalogParams(entry), ...params },
  };
}

function renderTuning(
  animationId: string,
  props: Partial<React.ComponentProps<typeof TuningPanel>> = {},
) {
  const entry = entryFor(animationId);
  const onParamChange = vi.fn();
  const onTriggerChange = vi.fn();
  const onChangeAnimation = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <TuningPanel
      vmId="vm-1"
      entry={entry}
      assignment={assignmentFor(entry)}
      onParamChange={onParamChange}
      onTriggerChange={onTriggerChange}
      onChangeAnimation={onChangeAnimation}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { ...view, entry, onParamChange, onTriggerChange, onChangeAnimation, onRemove };
}

describe("TuningPanel", () => {
  it("heads the panel with the element, the animation and a way back to the picker", () => {
    const { onChangeAnimation } = renderTuning("fade-in-up");

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(screen.getByText("vm-1")).toBeInTheDocument();
    expect(screen.getByText("Fade In Up")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(onChangeAnimation).toHaveBeenCalledOnce();
  });

  it("has no ‹ control unless it was given somewhere to go back to", () => {
    renderTuning("fade-in-up");

    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("shows ‹ when onBack is passed, and calls it", () => {
    const onBack = vi.fn();
    renderTuning("fade-in-up", { onBack });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("offers only the triggers the entry declares, in the handoff's words", () => {
    const { entry, onTriggerChange } = renderTuning("fade-in-up");

    const group = screen.getByRole("radiogroup", { name: "Trigger" });
    expect(within(group).getAllByRole("radio")).toHaveLength(entry.triggers.length);
    expect(within(group).getByRole("radio", { name: "On load" })).toBeChecked();
    expect(within(group).queryByRole("radio", { name: "On hover" })).not.toBeInTheDocument();

    fireEvent.click(within(group).getByRole("radio", { name: "In view" }));
    expect(onTriggerChange).toHaveBeenCalledWith("in-view");
  });

  it("renders duration and delay as slider rows seeded from the assignment", () => {
    renderTuning("fade-in");

    const duration = screen.getByLabelText("Duration");
    expect(duration.tagName).toBe("INPUT");
    expect(duration).toHaveAttribute("aria-valuenow", "600");
    expect(duration).toHaveAttribute("min", "100");
    expect(duration).toHaveAttribute("max", "5000");

    expect(screen.getByRole("spinbutton", { name: "Duration value" })).toHaveValue("600");
    expect(screen.getByRole("spinbutton", { name: "Delay value" })).toHaveValue("0");
  });

  it("writes a slider change back with the catalog's unit", () => {
    const { onParamChange } = renderTuning("fade-in");

    const duration = screen.getByLabelText("Duration");
    duration.focus();
    fireEvent.keyDown(duration, { key: "ArrowRight" });

    expect(onParamChange).toHaveBeenCalledWith("duration", "650ms");
  });

  it("commits a typed number, clamped to the catalog's range", () => {
    const { onParamChange } = renderTuning("fade-in");

    const field = screen.getByRole("spinbutton", { name: "Duration value" });
    fireEvent.change(field, { target: { value: "99999" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onParamChange).toHaveBeenCalledWith("duration", "5000ms");
  });

  it("renders an entry's distance in px, from the catalog's range", () => {
    renderTuning("fade-in-up");

    const distance = screen.getByLabelText("Distance");
    expect(distance).toHaveAttribute("aria-valuenow", "24");
    expect(distance).toHaveAttribute("max", "200");
    expect(screen.getByText("px")).toBeInTheDocument();
  });

  it("renders an entry's scale as the handoff's × multiplier", () => {
    renderTuning("pulse");

    expect(screen.getByLabelText("Peak scale")).toHaveAttribute("aria-valuenow", "1.05");
    expect(screen.getByText("×")).toBeInTheDocument();
  });

  it("renders repeat as the dense 1 / 2 / 3 / ∞ segmented, with ∞ named out loud", () => {
    const { onParamChange } = renderTuning("pulse");

    const repeat = screen.getByRole("radiogroup", { name: "Repeat" });
    const infinite = within(repeat).getByRole("radio", { name: "Infinite" });
    expect(infinite).toBeChecked();
    expect(infinite).toHaveTextContent("∞");

    fireEvent.click(within(repeat).getByRole("radio", { name: "2" }));
    expect(onParamChange).toHaveBeenCalledWith("iteration", "2");
  });

  it("renders direction as a select — its keywords do not fit a segment", async () => {
    // Inline, four segments share ~198px and both "alternate" and
    // "alternate-reverse" come out as the same clipped word.
    const { onParamChange } = renderTuning("spin");

    const direction = screen.getByRole("combobox", { name: "Direction" });
    expect(direction).toHaveTextContent("normal");
    expect(screen.queryByRole("radiogroup", { name: "Direction" })).not.toBeInTheDocument();

    fireEvent.click(direction);
    const listbox = await screen.findByRole("listbox");
    selectOption(within(listbox).getByRole("option", { name: "alternate-reverse" }));

    await waitFor(() =>
      expect(onParamChange).toHaveBeenCalledWith("direction", "alternate-reverse"),
    );
  });

  it("renders fill mode as a select too — 'backwards' is nine characters", () => {
    renderTuning("fade-in");

    expect(screen.getByRole("combobox", { name: "Fill mode" })).toHaveTextContent("both");
    expect(screen.queryByRole("radiogroup", { name: "Fill mode" })).not.toBeInTheDocument();
  });

  it("gives the select row the same shape as the easing row, minus the curve", () => {
    const { container } = renderTuning("spin");

    const row = container.querySelector("[data-param='direction']");
    expect(row?.className).toContain("items-center");
    expect(row?.querySelector("[data-testid='easing-curve']")).toBeNull();
    // …while easing keeps its preview.
    expect(
      container.querySelector("[data-param='easing'] [data-testid='easing-curve']"),
    ).not.toBeNull();
  });

  it("renders easing as a select with the curve drawn beside it", async () => {
    const { container, onParamChange } = renderTuning("fade-in");

    const easing = screen.getByRole("combobox", { name: "Easing" });
    expect(easing).toHaveTextContent("ease-out");

    const curve = container.querySelector("[data-testid='easing-curve'] path");
    expect(curve).toHaveAttribute("d", easingCurvePath("ease-out", 40, 16));

    fireEvent.click(easing);
    const listbox = await screen.findByRole("listbox");
    selectOption(within(listbox).getByRole("option", { name: "linear" }));

    await waitFor(() => expect(onParamChange).toHaveBeenCalledWith("easing", "linear"));
  });

  it("draws a straight line for an easing it cannot parse", () => {
    const entry = entryFor("fade-in");
    const { container } = render(
      <TuningPanel
        vmId="vm-1"
        entry={entry}
        assignment={assignmentFor(entry, { easing: "steps(4, end)" })}
      />,
    );

    expect(container.querySelector("[data-testid='easing-curve'] path")).toHaveAttribute(
      "d",
      "M 0 16 L 40 0",
    );
  });

  it("renders a text field for colour params — catalog colours are rgba()", () => {
    const { onParamChange } = renderTuning("glow");

    const colour = screen.getByLabelText("Glow color");
    expect(colour).toHaveValue("rgba(99, 102, 241, 0.6)");

    fireEvent.change(colour, { target: { value: "#ff0000" } });
    expect(onParamChange).toHaveBeenCalledWith("color", "#ff0000");
  });

  it("keeps Replay disabled until the preview bridge exists, and removes on request", () => {
    const { onRemove } = renderTuning("fade-in");

    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove animation" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("shows a value the catalog never listed, rather than nothing at all", () => {
    // Reachable from the API, not from this UI: the control still has to
    // render as the value the draft holds.
    const entry = entryFor("pulse");
    render(
      <TuningPanel
        vmId="vm-1"
        entry={entry}
        assignment={assignmentFor(entry, { iteration: "5" })}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Repeat" })).toHaveTextContent("5");
  });

  it("renders a row for every param the entry declares", () => {
    const { container, entry } = renderTuning("glow");

    for (const param of entry.params) {
      expect(container.querySelector(`[data-param='${param.key}']`)).not.toBeNull();
    }
  });
});
