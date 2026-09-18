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
