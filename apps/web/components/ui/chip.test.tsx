import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Chip } from "./chip";

describe("Chip", () => {
  it("is a toggle button that reports its pressed state", () => {
    render(<Chip>Entrance</Chip>);

    expect(screen.getByRole("button", { name: "Entrance" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reports pressed when selected", () => {
    render(<Chip pressed>All</Chip>);

    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("fills with ink when pressed", () => {
    render(<Chip pressed>All</Chip>);

    const chip = screen.getByRole("button", { name: "All" });
    expect(chip.className).toContain("data-pressed:bg-vm-ink");
    expect(chip.className).toContain("data-pressed:text-vm-ink-inverse");
  });

  it("calls onPressedChange", () => {
    const onPressedChange = vi.fn();
    render(<Chip onPressedChange={onPressedChange}>Entrance</Chip>);

    fireEvent.click(screen.getByRole("button", { name: "Entrance" }));

    expect(onPressedChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it("does not toggle when disabled", () => {
    const onPressedChange = vi.fn();
    render(
      <Chip disabled onPressedChange={onPressedChange}>
        Entrance
      </Chip>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Entrance" }));

    expect(onPressedChange).not.toHaveBeenCalled();
  });
});
