import { keyframesName } from "animation-catalog";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntries } from "@/lib/catalog";

import { ChoosingPanel } from "./choosing";

const entries = getCatalogEntries();

function renderPicker(props: Partial<React.ComponentProps<typeof ChoosingPanel>> = {}) {
  const onPick = vi.fn();
  const onBack = vi.fn();
  const onSearchChange = vi.fn();
  const onCategoryChange = vi.fn();
  const view = render(
    <ChoosingPanel
      vmId="vm-1"
      search=""
      onSearchChange={onSearchChange}
      category="all"
      onCategoryChange={onCategoryChange}
      onPick={onPick}
      onBack={onBack}
      {...props}
    />,
  );
  return { ...view, onPick, onBack, onSearchChange, onCategoryChange };
}

describe("ChoosingPanel", () => {
  it("heads the picker with a back control and the element it is choosing for", () => {
    renderPicker();

    expect(screen.getByTestId("panel-choosing")).toBeInTheDocument();
    expect(screen.getByText("Choose animation")).toBeInTheDocument();
    expect(screen.getByText("vm-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });

  it("goes back when the back control is used", () => {
    const { onBack } = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("lists a card per current-catalog entry", () => {
    renderPicker();

    for (const entry of entries) {
      expect(screen.getByRole("button", { name: entry.name })).toBeInTheDocument();
    }
  });

  it("reports what is typed in the search field rather than filtering itself", () => {
    const { onSearchChange } = renderPicker();

    const search = screen.getByRole("searchbox", { name: "Search animations" });
    fireEvent.change(search, { target: { value: "fade" } });

    expect(onSearchChange).toHaveBeenCalledWith("fade");
  });

  it("shows only the entries matching the search it is given", () => {
    renderPicker({ search: "fade in" });

    expect(screen.getByRole("button", { name: "Fade In" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Spin" })).not.toBeInTheDocument();
  });

  it("says so when the search matches nothing", () => {
    renderPicker({ search: "zzzz" });

    expect(screen.getByText(/no animations match/i)).toHaveTextContent("zzzz");
  });

  it("offers a chip per catalog category, All first and pressed by default", () => {
    renderPicker();

    const all = screen.getByRole("button", { name: "All" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Entrance" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Continuous" })).toBeInTheDocument();
  });

  it("reports a chip press rather than filtering itself", () => {
    const { onCategoryChange } = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Entrance" }));

    expect(onCategoryChange).toHaveBeenCalledWith("entrance");
  });

  it("shows only the chosen category's entries", () => {
    renderPicker({ category: "hover" });

    expect(screen.getByRole("button", { name: "Hover Lift" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fade In" })).not.toBeInTheDocument();
  });

  it("applies the animation of the card that is clicked", () => {
    const { onPick } = renderPicker();

    fireEvent.click(screen.getByRole("button", { name: "Fade In" }));

    expect(onPick).toHaveBeenCalledWith("fade-in");
  });

  it("marks the animation already applied to this element", () => {
    renderPicker({ appliedAnimationId: "pulse" });

    expect(screen.getByRole("button", { name: "Pulse" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Fade In" })).not.toHaveAttribute("aria-current");
  });

  it("injects the keyframes of the visible entries once, so the demos can play", () => {
    const { container } = renderPicker({ search: "fade in up" });

    const style = container.querySelector("style");
    expect(style?.textContent).toContain("@keyframes vm-fade-in-up-v1");
    expect(style?.textContent).not.toContain("@keyframes vm-spin-v1");
  });

  it("moves the highlight down and up the grid with the arrow keys", () => {
    renderPicker({ search: "fade in" });
    const cards = screen.getAllByTestId("animation-card");

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search animations" }), {
      key: "ArrowDown",
    });
    expect(document.activeElement).toBe(cards[0]);

    fireEvent.keyDown(cards[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(cards[1]);

    fireEvent.keyDown(cards[1], { key: "ArrowUp" });
    expect(document.activeElement).toBe(cards[0]);
  });

  it("stops at the ends of the list rather than wrapping", () => {
    renderPicker({ search: "fade in up" });
    const [only] = screen.getAllByTestId("animation-card");

    fireEvent.keyDown(only, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "ArrowUp" });

    expect(document.activeElement).toBe(only);
  });

  it("applies the highlighted animation on Enter", () => {
    const { onPick } = renderPicker({ search: "fade in" });
    const cards = screen.getAllByTestId("animation-card");

    fireEvent.keyDown(cards[0], { key: "ArrowDown" });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Enter" });

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith("fade-in");
  });

  it("does nothing on Enter before anything is highlighted", () => {
    const { onPick } = renderPicker();

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search animations" }), {
      key: "Enter",
    });

    expect(onPick).not.toHaveBeenCalled();
  });

  it("keeps the handoff's footer caption about previewing and applying", () => {
    renderPicker();

    expect(
      screen.getByText("Hover a card to preview on the page · click to apply"),
    ).toBeInTheDocument();
  });

  it("pins its demos to the catalog version it was given", () => {
    const onlyFadeIn = entries.filter((entry) => entry.id === "fade-in");
    const { container } = renderPicker({ entries: onlyFadeIn, catalogVersion: "1.0.0" });

    // The injected `@keyframes` block, and what the demo plays, both name the
    // version asked for — not whatever `current` happens to be today.
    const pinnedName = keyframesName("fade-in", "1.0.0");
    expect(pinnedName).not.toBe(keyframesName("fade-in", CURRENT_CATALOG_VERSION));
    expect(container.querySelector("style")?.textContent).toContain(
      `@keyframes ${pinnedName} {`,
    );

    const demo = within(container).getByTestId("animation-card-demo");
    // The demo only carries its animation while the card is hovered or focused.
    fireEvent.focus(within(container).getByTestId("animation-card"));
    expect(demo.style.animationName).toBe(pinnedName);
  });

  it("renders one card per entry it is given", () => {
    const { container } = renderPicker({ catalogVersion: CURRENT_CATALOG_VERSION });

    expect(within(container).getAllByTestId("animation-card").length).toBe(entries.length);
  });
});
