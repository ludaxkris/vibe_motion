import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

import { TopBar } from "./top-bar";

describe("TopBar", () => {
  it("always shows the wordmark", () => {
    render(<TopBar />);

    expect(screen.getByText("Vibe Motion")).toBeInTheDocument();
  });

  it("is the handoff's 44px violet bar", () => {
    const { container } = render(<TopBar />);

    const bar = container.querySelector("[data-slot='top-bar']");
    expect(bar).toHaveClass("h-[var(--topbar-h)]", "bg-vm-bar", "text-vm-bar-ink");
  });

  it("shows the context title and chip after a divider", () => {
    const { container } = render(<TopBar title="nimbus.app/pricing" chip="v5" />);

    expect(screen.getByText("nimbus.app/pricing")).toBeInTheDocument();
    expect(screen.getByText("v5")).toHaveClass("font-mono", "bg-vm-bar-chip");
    expect(container.querySelector("[data-slot='top-bar-divider']")).toBeInTheDocument();
  });

  it("omits the divider and context when there is none", () => {
    const { container } = render(<TopBar />);

    expect(container.querySelector("[data-slot='top-bar-divider']")).toBeNull();
    expect(container.querySelector("[data-slot='top-bar-context']")).toBeNull();
  });

  it("takes a chip without a title", () => {
    render(<TopBar chip="catalog 1.0.0" />);

    expect(screen.getByText("catalog 1.0.0")).toBeInTheDocument();
  });

  it("puts actions at the end of the bar", () => {
    const { container } = render(
      <TopBar
        title="nimbus.app/pricing"
        actions={
          <>
            <Button variant="bar-outline">Cancel</Button>
            <Button variant="bar-primary">Save</Button>
          </>
        }
      />,
    );

    const actions = container.querySelector("[data-slot='top-bar-actions']");
    expect(actions).toHaveClass("ms-auto");
    expect(actions).toContainElement(screen.getByRole("button", { name: "Save" }));
    expect(actions).toContainElement(screen.getByRole("button", { name: "Cancel" }));
  });
});
