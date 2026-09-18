import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntry } from "@/lib/catalog";

import { AnimationCard } from "./animation-card";

const entry = getCatalogEntry("fade-in-up")!;

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: () => {}, removeEventListener: () => {} })),
  );
}

function renderCard(props: Partial<React.ComponentProps<typeof AnimationCard>> = {}) {
  render(<AnimationCard entry={entry} catalogVersion={CURRENT_CATALOG_VERSION} {...props} />);
  return {
    card: screen.getByRole("button", { name: entry.name }),
    demo: screen.getByTestId("animation-card-demo"),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnimationCard", () => {
  it("is a button named after the animation, still at rest", () => {
    const { card, demo } = renderCard();

    expect(card).toBeInTheDocument();
    expect(demo).not.toHaveStyle({ animationName: `vm-${entry.id}` });
    expect(demo.getAttribute("style") ?? "").not.toContain("animation-name");
  });

  it("plays the entry's own keyframes while hovered, and stops on leave", () => {
    const { card, demo } = renderCard();

    fireEvent.mouseEnter(card);
    const style = demo.getAttribute("style") ?? "";
    expect(style).toContain("animation-name: vm-fade-in-up-v1");
    expect(style).toContain("animation-duration: 600ms");
    // The entry's own cssVar param rides along, so the demo moves as far as
    // the real thing would.
    expect(style).toContain("--vm-distance: 24px");

    fireEvent.mouseLeave(card);
    expect(demo.getAttribute("style") ?? "").not.toContain("animation-name");
  });

  it("plays on keyboard focus too, so the demo is not mouse-only", () => {
    const { card, demo } = renderCard();

    fireEvent.focus(card);
    expect(demo.getAttribute("style") ?? "").toContain("animation-name");

    fireEvent.blur(card);
    expect(demo.getAttribute("style") ?? "").not.toContain("animation-name");
  });

  it("stays still when the OS asks for reduced motion", () => {
    stubReducedMotion(true);
    const { card, demo } = renderCard();

    fireEvent.mouseEnter(card);

    expect(demo.getAttribute("style") ?? "").not.toContain("animation-name");
  });

  it("applies on click, reduced motion or not", () => {
    stubReducedMotion(true);
    const onApply = vi.fn();
    const { card } = renderCard({ onApply });

    fireEvent.click(card);

    expect(onApply).toHaveBeenCalledOnce();
  });

  it("marks the animation already on the element as the current one", () => {
    renderCard({ applied: true });

    expect(screen.getByRole("button", { name: entry.name })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("leaves every other card without a current marker", () => {
    renderCard();

    expect(screen.getByRole("button", { name: entry.name })).not.toHaveAttribute("aria-current");
  });
});
