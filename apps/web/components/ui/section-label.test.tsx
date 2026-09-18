import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SectionLabel } from "./section-label";

describe("SectionLabel", () => {
  it("is 11px semibold uppercase with label tracking", () => {
    render(<SectionLabel>Trigger</SectionLabel>);

    const label = screen.getByText("Trigger");
    expect(label).toHaveClass("text-xs", "font-semibold", "uppercase", "tracking-label");
    expect(label).toHaveClass("text-vm-ink-2");
  });

  it("takes an id so a section can point its aria-labelledby at it", () => {
    render(<SectionLabel id="trigger-label">Trigger</SectionLabel>);

    expect(screen.getByText("Trigger")).toHaveAttribute("id", "trigger-label");
  });
});
