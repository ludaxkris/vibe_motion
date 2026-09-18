import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ElementTag } from "./element-tag";

describe("ElementTag", () => {
  it("sets the identifier in mono", () => {
    render(<ElementTag>h1</ElementTag>);

    expect(screen.getByText("h1")).toHaveClass("font-mono");
  });

  it("fills with the accent for the current selection", () => {
    render(<ElementTag>a.cta</ElementTag>);

    expect(screen.getByText("a.cta")).toHaveClass("bg-vm-accent", "text-vm-ink-inverse");
  });

  it("is muted in lists", () => {
    render(<ElementTag tone="muted">.plan ×3</ElementTag>);

    expect(screen.getByText(".plan ×3")).toHaveClass("bg-vm-surface-muted", "text-vm-ink");
  });

  it("has a small size for row meta", () => {
    render(<ElementTag size="sm">h1</ElementTag>);

    expect(screen.getByText("h1")).toHaveClass("text-xs");
  });
});
