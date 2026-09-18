import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { NumberField } from "./number-field";

/** The field is controlled in the editor: the same param is also driven by its slider. */
function Harness({
  initialValue = 600,
  onCommit,
}: {
  initialValue?: number;
  onCommit: (value: number) => void;
}) {
  const [value, setValue] = React.useState(initialValue);
  return (
    <NumberField
      aria-label="Duration"
      value={value}
      min={100}
      max={3000}
      step={50}
      unit="ms"
      onCommit={(next) => {
        setValue(next);
        onCommit(next);
      }}
    />
  );
}

function renderField(initialValue?: number) {
  const onCommit = vi.fn();
  render(<Harness initialValue={initialValue} onCommit={onCommit} />);
  return { onCommit, field: screen.getByRole("spinbutton", { name: "Duration" }) };
}

describe("NumberField", () => {
  it("exposes the value range to assistive tech", () => {
    const { field } = renderField();

    expect(field).toHaveValue("600");
    expect(field).toHaveAttribute("aria-valuenow", "600");
    expect(field).toHaveAttribute("aria-valuemin", "100");
    expect(field).toHaveAttribute("aria-valuemax", "3000");
  });

  it("renders the unit in faint ink, hidden from screen readers", () => {
    renderField();

    const unit = screen.getByText("ms");
    expect(unit).toHaveAttribute("aria-hidden", "true");
    expect(unit).toHaveClass("text-vm-ink-3");
  });

  it("does not commit while typing", () => {
    const { onCommit, field } = renderField();

    fireEvent.change(field, { target: { value: "12" } });

    expect(field).toHaveValue("12");
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("commits on blur", () => {
    const { onCommit, field } = renderField();

    fireEvent.change(field, { target: { value: "900" } });
    fireEvent.blur(field);

    expect(onCommit).toHaveBeenCalledWith(900);
  });

  it("commits on Enter", () => {
    const { onCommit, field } = renderField();

    fireEvent.change(field, { target: { value: "900" } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith(900);
  });

  it("clamps a committed value to min and max", () => {
    const { onCommit, field } = renderField();

    fireEvent.change(field, { target: { value: "9000" } });
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenLastCalledWith(3000);

    fireEvent.change(field, { target: { value: "0" } });
    fireEvent.blur(field);
    expect(onCommit).toHaveBeenLastCalledWith(100);
  });

  it("restores the current value when the entry is not a number", () => {
    const { onCommit, field } = renderField();

    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.blur(field);

    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue("600");
  });

  it("steps with ArrowUp and ArrowDown", () => {
    const { onCommit, field } = renderField();

    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(onCommit).toHaveBeenLastCalledWith(650);
    expect(field).toHaveValue("650");

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(onCommit).toHaveBeenLastCalledWith(600);
    expect(field).toHaveValue("600");
  });

  it("steps from the committed value when the field has been cleared", () => {
    const { onCommit, field } = renderField();

    fireEvent.change(field, { target: { value: "" } });
    fireEvent.keyDown(field, { key: "ArrowUp" });

    // Not 50: `Number("")` is 0, which would step from the bottom of the range.
    expect(onCommit).toHaveBeenLastCalledWith(650);
  });

  it("stops stepping at the ends of the range", () => {
    const { onCommit, field } = renderField(3000);

    fireEvent.keyDown(field, { key: "ArrowUp" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(field).toHaveValue("3000");
  });

  it("follows the value when it changes elsewhere, e.g. from the slider", () => {
    const { rerender } = render(
      <NumberField aria-label="Duration" value={600} min={100} max={3000} step={50} unit="ms" />,
    );
    rerender(
      <NumberField aria-label="Duration" value={1200} min={100} max={3000} step={50} unit="ms" />,
    );

    expect(screen.getByRole("spinbutton", { name: "Duration" })).toHaveValue("1200");
  });

  it("is the handoff's 62×28 mono box", () => {
    const { field } = renderField();

    const box = field.closest("[data-slot='number-field']");
    expect(box).toHaveClass("w-[62px]", "h-[var(--control-h-xs)]");
    expect(field).toHaveClass("font-mono");
  });
});
