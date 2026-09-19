import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CURRENT_CATALOG_VERSION,
  catalogCategories,
  categoryLabel,
  getCatalogEntries,
} from "@/lib/catalog";

import { CATEGORY_BLURBS, HelpScreen } from "./help-screen";

const entries = getCatalogEntries();

function renderHelp() {
  render(<HelpScreen entries={entries} catalogVersion={CURRENT_CATALOG_VERSION} />);
}

function search(): HTMLElement {
  return screen.getByRole("searchbox", { name: "Search animations" });
}

describe("HelpScreen", () => {
  it("shows the whole current catalog, one card per entry", () => {
    renderHelp();

    expect(screen.getAllByTestId("catalog-card")).toHaveLength(entries.length);
  });

  it("names the screen in the top bar, in the bar's own white, and pins the version", () => {
    renderHelp();

    expect(screen.getByText("Animations")).toHaveClass("text-vm-bar-ink");
    expect(screen.getByText(`catalog ${CURRENT_CATALOG_VERSION}`)).toBeInTheDocument();
  });

  it("counts the catalog on the chips: all of it, then each category present", () => {
    renderHelp();

    expect(screen.getByRole("button", { name: `All ${entries.length}` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrance 9" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attention 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Emphasis 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuous 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hover 3" })).toBeInTheDocument();
  });

  it("carries a blurb for every category the catalog has", () => {
    for (const category of catalogCategories(entries)) {
      expect(CATEGORY_BLURBS[category], `blurb for "${category}"`).toBeTruthy();
    }

    renderHelp();
    const entrance = screen.getByRole("region", { name: "Entrance" });
    expect(within(entrance).getByText(CATEGORY_BLURBS.entrance)).toBeInTheDocument();
  });

  it("names each section by its own heading", () => {
    renderHelp();

    const entrance = screen.getByRole("region", { name: "Entrance" });
    const heading = within(entrance).getByRole("heading", { level: 2, name: "Entrance" });
    expect(entrance).toHaveAttribute("aria-labelledby", heading.id);
  });

  it("narrows to one section when its chip is pressed", () => {
    renderHelp();

    fireEvent.click(screen.getByRole("button", { name: "Exit 3" }));

    expect(screen.getAllByTestId("catalog-card")).toHaveLength(3);
    expect(screen.getByRole("region", { name: "Exit" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Entrance" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters by name as you search, and the chips re-count what is left", () => {
    renderHelp();

    fireEvent.change(search(), { target: { value: "fade" } });

    // Fade In / Up / Down / Left / Right, Fade Out, Fade Out Down.
    expect(screen.getAllByTestId("catalog-card")).toHaveLength(7);
    expect(screen.getByRole("button", { name: "All 7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrance 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit 2" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Attention" })).not.toBeInTheDocument();
  });

  it("stops offering a category the search has emptied", () => {
    renderHelp();

    fireEvent.change(search(), { target: { value: "fade" } });

    expect(screen.getByRole("button", { name: "Attention 0" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Entrance 5" })).toBeEnabled();
  });

  it("says so when nothing matches", () => {
    renderHelp();

    fireEvent.change(search(), { target: { value: "zzz" } });

    expect(screen.queryAllByTestId("catalog-card")).toHaveLength(0);
    expect(screen.getByText("No animations match “zzz”.")).toBeInTheDocument();
  });

  it("names the category in the empty copy the way its own chip does", () => {
    // Through `categoryLabel`, like the chip and the section heading — not off
    // the raw catalog id, which is only the same string today.
    for (const category of catalogCategories(entries)) {
      const label = categoryLabel(category);
      renderHelp();

      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label} \\d+$`) }));
      fireEvent.change(search(), { target: { value: "zzz" } });

      expect(
        screen.getByText(`No ${label.toLowerCase()} animations match “zzz”.`),
      ).toBeInTheDocument();
      cleanup();
    }
  });

  it("replays every visible card, hover-trigger ones included", () => {
    renderHelp();

    const before = screen.getAllByTestId("catalog-card-demo");
    const hoverSection = screen.getByRole("region", { name: "Hover" });
    const hoverDemoBefore = within(hoverSection).getAllByTestId("catalog-card-demo")[0];

    fireEvent.click(screen.getByRole("button", { name: "Replay all" }));

    const after = screen.getAllByTestId("catalog-card-demo");
    expect(after).toHaveLength(before.length);
    expect(after[0]).not.toBe(before[0]);
    // "Replay all" is the user asking, so every card is let through the
    // stylesheet's reduced-motion rule for the length of the run.
    expect(after[0]).toHaveAttribute("data-vm-replayed");

    const hoverDemoAfter = within(
      screen.getByRole("region", { name: "Hover" }),
    ).getAllByTestId("catalog-card-demo")[0];
    expect(hoverDemoAfter).not.toBe(hoverDemoBefore);
    expect(hoverDemoAfter).toHaveAttribute("data-vm-replayed");
  });

  it("ships the reduced-motion note in the HTML, for the media query to reveal", () => {
    // Not behind a client hook: a note that only appears after hydration is a
    // note the reader has already stopped needing.
    renderHelp();

    const note = screen.getByText(
      "Your system asks for reduced motion, so nothing plays on its own. Replay a card to see it move.",
    );
    expect(note).toHaveClass("hidden", "motion-reduce:block");
  });
});
