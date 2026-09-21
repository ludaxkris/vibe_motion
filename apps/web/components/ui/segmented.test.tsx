import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { Segmented } from "./segmented";

const TRIGGERS = [
  { value: "load", label: "On load" },
  { value: "hover", label: "On hover" },
  { value: "in-view", label: "In view" },
] as const;

function Harness({ onValueChange }: { onValueChange: (value: string) => void }) {
  const [value, setValue] = React.useState<string>("load");
  return (
    <Segmented
      aria-label="Trigger"
      options={TRIGGERS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onValueChange(next);
      }}
    />
  );
}

describe("Segmented", () => {
  it("is a radio group with one radio per option", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    const group = screen.getByRole("radiogroup", { name: "Trigger" });
    expect(group).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "On load" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "On hover" })).not.toBeChecked();
  });

  it("selects on click", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "On hover" }));

    expect(onValueChange).toHaveBeenCalledWith("hover");
    expect(screen.getByRole("radio", { name: "On hover" })).toBeChecked();
  });

  it("moves the selection with the arrow keys", async () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    const selected = screen.getByRole("radio", { name: "On load" });
    selected.focus();
    fireEvent.keyDown(selected, { key: "ArrowRight" });

    // Base UI moves focus in a microtask, and the selection follows focus.
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith("hover"));
    expect(screen.getByRole("radio", { name: "On hover" })).toBeChecked();
  });

  it("marks the selected segment with the raised white surface", () => {
    const onValueChange = vi.fn();
    render(<Harness onValueChange={onValueChange} />);

    const selected = screen.getByRole("radio", { name: "On load" });
    expect(selected.className).toContain("data-checked:bg-vm-surface");
    expect(selected.className).toContain("data-checked:text-vm-accent-strong");
  });

  it("uses tighter padding when dense", () => {
    render(
      <Segmented
        aria-label="Repeat"
        dense
        options={[
          { value: "1", label: "1" },
          { value: "infinite", label: "∞" },
        ]}
        value="1"
      />,
    );

    expect(screen.getByRole("radio", { name: "1" })).toHaveClass("py-1");
  });

  it("names a glyph segment out loud, and keeps the glyph on screen", () => {
    render(
      <Segmented
        aria-label="Repeat"
        dense
        options={[
          { value: "1", label: "1" },
          { value: "infinite", label: "∞", ariaLabel: "Infinite" },
        ]}
        value="1"
      />,
    );

    const infinite = screen.getByRole("radio", { name: "Infinite" });
    expect(infinite).toHaveTextContent("∞");
    expect(screen.queryByRole("radio", { name: "∞" })).not.toBeInTheDocument();
  });

  it("titles every segment, so a label the box clips is still discoverable", () => {
    render(
      <Segmented
        aria-label="Repeat"
        options={[
          { value: "1", label: "1" },
          { value: "infinite", label: "∞", ariaLabel: "Infinite" },
        ]}
        value="1"
      />,
    );

    expect(screen.getByRole("radio", { name: "1" })).toHaveAttribute("title", "1");
    // The tooltip says the word, not the glyph — "∞" would tell no one anything.
    expect(screen.getByRole("radio", { name: "Infinite" })).toHaveAttribute("title", "Infinite");
  });

  it("puts one segment out of action while the rest stay live (DT-173)", () => {
    const onValueChange = vi.fn();
    render(
      <Segmented
        aria-label="Export mode"
        options={[
          { value: "full", label: "Full page" },
          { value: "snippet", label: "Snippet", disabled: true },
        ]}
        value="full"
        onValueChange={onValueChange}
      />,
    );

    const snippet = screen.getByRole("radio", { name: "Snippet" });
    expect(snippet).toHaveAttribute("data-disabled");
    fireEvent.click(snippet);
    expect(onValueChange).not.toHaveBeenCalled();

    const full = screen.getByRole("radio", { name: "Full page" });
    expect(full).not.toHaveAttribute("data-disabled");
    expect(screen.getByRole("radiogroup", { name: "Export mode" })).not.toHaveAttribute(
      "data-disabled",
    );
  });

  it("dims a disabled control once, not once per segment", () => {
    // Base UI marks the group *and* every segment disabled, so two 40% rules
    // would multiply to 16%; the handoff says 40% (docs/design/README.md).
    render(
      <Segmented
        aria-label="Trigger"
        disabled
        options={[...TRIGGERS, { value: "x", label: "X", disabled: true }]}
        value="load"
      />,
    );

    const group = screen.getByRole("radiogroup", { name: "Trigger" });
    expect(group).toHaveAttribute("data-disabled");
    expect(group.className).toContain("data-disabled:opacity-40");

    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("data-disabled");
      // Higher specificity than the segment's own rule, so within a disabled
      // group the segment contributes no second 40%.
      expect(radio.className).toContain("group-data-disabled/segmented:data-disabled:opacity-100");
    }
    expect(group.className).toContain("group/segmented");
  });

  it("does not respond when disabled", () => {
    const onValueChange = vi.fn();
    render(
      <Segmented
        aria-label="Trigger"
        disabled
        options={TRIGGERS}
        value="load"
        onValueChange={onValueChange}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "On hover" }));

    expect(onValueChange).not.toHaveBeenCalled();
  });
});
