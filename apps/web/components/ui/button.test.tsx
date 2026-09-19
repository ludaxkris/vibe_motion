import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";

/**
 * The variants and sizes come straight from the handoff
 * (`docs/design/design-system/components/core/Button.jsx`). Asserting the
 * token-bearing class name is the only way to pin the palette in jsdom, which
 * has no layout and no stylesheet.
 */
describe("Button", () => {
  it("renders a button with its label", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("calls onClick", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    fireEvent.click(button);

    expect(onClick).not.toHaveBeenCalled();
  });

  it.each([
    ["primary", "bg-vm-accent"],
    ["secondary", "bg-vm-surface"],
    ["ink", "bg-vm-ink"],
    ["bar-primary", "bg-vm-bar-accent"],
    ["bar-outline", "border-vm-bar-border"],
    ["danger-link", "text-vm-danger"],
    ["link", "text-vm-accent"],
  ] as const)("variant %s carries the %s token class", (variant, tokenClass) => {
    render(<Button variant={variant}>Action</Button>);

    expect(screen.getByRole("button", { name: "Action" })).toHaveClass(tokenClass);
  });

  it.each([
    ["xs", "h-[var(--control-h-xs)]"],
    ["sm", "h-[var(--control-h-sm)]"],
    ["md", "h-[var(--control-h-md)]"],
    ["lg", "h-[var(--control-h-lg)]"],
    ["xl", "h-[var(--control-h-xl)]"],
  ] as const)("size %s uses the %s control height token", (size, tokenClass) => {
    render(<Button size={size}>Action</Button>);

    expect(screen.getByRole("button", { name: "Action" })).toHaveClass(tokenClass);
  });

  it("dims to 40% when disabled and never scales on press", () => {
    render(<Button disabled>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("disabled:opacity-40");
    expect(button.className).not.toMatch(/active:(scale|translate)/);
  });

  it("adds the accent glow only when asked for", () => {
    const { rerender } = render(<Button variant="primary">Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).not.toHaveClass("shadow-accent");

    rerender(
      <Button variant="primary" glow>
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("shadow-accent");
  });

  it("renders a leading glyph that screen readers skip", () => {
    render(<Button glyph="✦">Auto-generate for this page</Button>);

    const button = screen.getByRole("button", { name: "Auto-generate for this page" });
    const glyph = button.querySelector("[aria-hidden='true']");
    expect(glyph).toHaveTextContent("✦");
  });

  it("tints ✦ with the accent on a secondary button", () => {
    // The handoff tints the icon slot, which is ✦ (Button.jsx, idle panel).
    const { container } = render(
      <Button variant="secondary" glyph="✦">
        Auto-generate for this page
      </Button>,
    );

    expect(container.querySelector("[aria-hidden='true']")).toHaveClass("text-vm-accent");
  });

  it("leaves an ink-toned glyph in the label's own colour", () => {
    // ↻ is part of the label in the handoff ("↻ Replay all"), not an icon.
    const { container } = render(
      <Button variant="secondary" glyph="↻" glyphTone="ink">
        Replay all
      </Button>,
    );

    expect(container.querySelector("[aria-hidden='true']")).not.toHaveClass("text-vm-accent");
  });
});
