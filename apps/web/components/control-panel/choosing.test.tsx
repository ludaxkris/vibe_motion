import { keyframesName } from "animation-catalog";
import { createEvent, fireEvent, render, screen, within } from "@testing-library/react";
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
    const [first] = screen.getAllByTestId("animation-card");

    fireEvent.focus(first);
    fireEvent.keyDown(first, { key: "Enter" });

    expect(onPick).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledWith("fade-in");
  });

  it("applies the card the arrow keys moved to, not the one they started from", () => {
    const { onPick } = renderPicker({ search: "fade in" });
    const cards = screen.getAllByTestId("animation-card");
    const second = cards[1].textContent ?? "";

    fireEvent.focus(cards[0]);
    fireEvent.keyDown(cards[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(cards[1]);

    fireEvent.keyDown(cards[1], { key: "Enter" });

    expect(onPick).toHaveBeenCalledOnce();
    expect(entries.find((entry) => entry.id === onPick.mock.calls[0][0])?.name).toBe(second);
  });

  it("does nothing on Enter before anything is highlighted", () => {
    const { onPick } = renderPicker();

    fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search animations" }), {
      key: "Enter",
    });

    expect(onPick).not.toHaveBeenCalled();
  });

  /**
   * The picker's keys belong to the card grid and to nothing else. Once a card
   * has been highlighted, the header, the search field and the chips still have
   * to get their own keys — anything else hands a keyboard user a different
   * action than the control they are standing on.
   */
  describe("once the highlight has left the grid", () => {
    /** Arrow into the grid, then move focus on to `next`, as Shift+Tab would. */
    function highlightThenLeaveTo(next: HTMLElement) {
      const [first] = screen.getAllByTestId("animation-card");
      fireEvent.keyDown(screen.getByRole("searchbox", { name: "Search animations" }), {
        key: "ArrowDown",
      });
      expect(document.activeElement).toBe(first);

      fireEvent.blur(first, { relatedTarget: next });
      next.focus();
    }

    it("Enter on a category chip filters and applies nothing", () => {
      const { onPick, onCategoryChange } = renderPicker({ search: "fade in" });
      const chip = screen.getByRole("button", { name: "Entrance" });
      highlightThenLeaveTo(chip);

      const enter = createEvent.keyDown(chip, { key: "Enter" });
      fireEvent(chip, enter);
      // Nothing swallowed the key, so the browser still activates the chip.
      expect(enter.defaultPrevented).toBe(false);
      fireEvent.click(chip);

      expect(onCategoryChange).toHaveBeenCalledWith("entrance");
      expect(onPick).not.toHaveBeenCalled();
    });

    it("Enter on the back control goes back and applies nothing", () => {
      const { onPick, onBack } = renderPicker({ search: "fade in" });
      const back = screen.getByRole("button", { name: "Back" });
      highlightThenLeaveTo(back);

      const enter = createEvent.keyDown(back, { key: "Enter" });
      fireEvent(back, enter);
      expect(enter.defaultPrevented).toBe(false);
      fireEvent.click(back);

      expect(onBack).toHaveBeenCalledOnce();
      expect(onPick).not.toHaveBeenCalled();
    });

    it("Enter in the search field applies nothing", () => {
      const { onPick } = renderPicker({ search: "fade in" });
      const search = screen.getByRole("searchbox", { name: "Search animations" });
      highlightThenLeaveTo(search);

      const enter = createEvent.keyDown(search, { key: "Enter" });
      fireEvent(search, enter);

      expect(enter.defaultPrevented).toBe(false);
      expect(onPick).not.toHaveBeenCalled();
    });
  });

  it("leaves the caret keys to the search field", () => {
    renderPicker({ search: "fade in" });
    const search = screen.getByRole("searchbox", { name: "Search animations" });
    const [first] = screen.getAllByTestId("animation-card");
    search.focus();

    for (const key of ["ArrowUp", "ArrowLeft", "ArrowRight"]) {
      const event = createEvent.keyDown(search, { key });
      fireEvent(search, event);

      expect(event.defaultPrevented, `${key} is the caret's`).toBe(false);
      expect(document.activeElement, `${key} keeps focus in the field`).toBe(search);
    }

    // …and ArrowDown is the one that steps into the list.
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(first);
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
