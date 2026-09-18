import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Slider } from "./slider";

describe("Slider", () => {
  it("puts aria-label on the focusable input, not the wrapper", () => {
    const { container } = render(<Slider aria-label="Duration" value={[600]} max={3000} />);

    expect(screen.getByLabelText("Duration").tagName).toBe("INPUT");
    expect(container.querySelector("[data-slot='slider']")).not.toHaveAttribute("aria-label");
  });

  it("is a 4px lavender track with an accent fill", () => {
    const { container } = render(<Slider aria-label="Duration" value={[600]} max={3000} />);

    expect(container.querySelector("[data-slot='slider-track']")).toHaveClass(
      "data-horizontal:h-[var(--slider-track-h)]",
      "bg-vm-surface-sunken",
    );
    expect(container.querySelector("[data-slot='slider-range']")).toHaveClass("bg-vm-accent");
  });

  it("has a 14px white thumb ringed in the accent", () => {
    const { container } = render(<Slider aria-label="Duration" value={[600]} max={3000} />);

    expect(container.querySelector("[data-slot='slider-thumb']")).toHaveClass(
      "size-[var(--slider-thumb)]",
      "bg-vm-surface",
      "shadow-thumb",
    );
  });
});
