import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CURRENT_CATALOG_VERSION, catalogCategories, getCatalogEntries } from "@/lib/catalog";

import { CATEGORY_BLURBS, HelpScreen } from "./help-screen";

const entries = getCatalogEntries();

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: () => {}, removeEventListener: () => {} })),
  );
}

/** Hands back the queued frame callbacks so a replay can be stepped by hand. */
function stubAnimationFrames() {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  return () => {
    const queued = frames.splice(0, frames.length);
    for (const callback of queued) callback(0);
  };
}

function renderHelp() {
  render(<HelpScreen entries={entries} catalogVersion={CURRENT_CATALOG_VERSION} />);
}

function search(): HTMLElement {
  return screen.getByRole("searchbox", { name: "Search animations" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HelpScreen", () => {
  it("shows the whole current catalog, one card per entry", () => {
    renderHelp();

    expect(screen.getAllByTestId("catalog-card")).toHaveLength(entries.length);
  });

  it("names the screen in the top bar and pins the catalog version", () => {
    renderHelp();

    expect(screen.getByText("Animations")).toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: "Attention 0" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Attention" })).not.toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    renderHelp();

    fireEvent.change(search(), { target: { value: "zzz" } });

    expect(screen.queryAllByTestId("catalog-card")).toHaveLength(0);
    expect(screen.getByText("No animations match \u201czzz\u201d.")).toBeInTheDocument();
  });

  it("replays every visible card, hover-trigger ones included", () => {
    const runFrames = stubAnimationFrames();
    renderHelp();

    const styleOf = (element: HTMLElement) => element.getAttribute("style") ?? "";
    const first = screen.getAllByTestId("catalog-card-demo")[0];
    // Fade In plays on load; Hover Lift waits to be pointed at.
    expect(styleOf(first)).toContain("animation-name");
    const hoverDemo = within(
      screen.getByRole("region", { name: "Hover" }),
    ).getAllByTestId("catalog-card-demo")[0];
    expect(styleOf(hoverDemo)).not.toContain("animation-name");

    fireEvent.click(screen.getByRole("button", { name: "Replay all" }));

    expect(styleOf(first)).toContain("animation-name: none");
    expect(styleOf(hoverDemo)).toContain("animation-name");

    runFrames();
    expect(styleOf(first)).not.toContain("animation-name: none");
  });

  it("autoplays nothing under prefers-reduced-motion, and says why", () => {
    stubReducedMotion(true);
    renderHelp();

    for (const demo of screen.getAllByTestId("catalog-card-demo")) {
      expect(demo.getAttribute("style") ?? "").not.toContain("animation-name");
    }
    expect(
      screen.getByText(
        "Your system asks for reduced motion, so nothing plays on its own. Replay a card to see it move.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the note away when motion is welcome", () => {
    renderHelp();

    expect(screen.queryByText(/reduced motion/)).not.toBeInTheDocument();
  });
});
