import { fireEvent, render, screen } from "@testing-library/react";
import { keyframesName } from "animation-catalog";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogEntry } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry } from "@/lib/catalog";

import { CatalogCard } from "./catalog-card";

const entry = (id: string): CatalogEntry => {
  const found = getCatalogEntry(id);
  if (!found) throw new Error(`no catalog entry "${id}"`);
  return found;
};

/** Defaults to the `load` trigger. */
const fadeInUp = entry("fade-in-up");
/** Defaults to the `hover` trigger: it replays on hover as well. */
const hoverLift = entry("hover-lift");
/** Runs forever until something stops it. */
const pulse = entry("pulse");

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches, addEventListener: () => {}, removeEventListener: () => {} })),
  );
}

/**
 * jsdom defines no `AnimationEvent`, so React falls back to the vendor-
 * prefixed name when it registers the listener behind `onAnimationEnd` — and
 * a plain `animationend` event reaches nothing. Send both.
 */
function endAnimation(element: HTMLElement) {
  for (const type of ["animationend", "webkitAnimationEnd"]) {
    fireEvent(element, new Event(type, { bubbles: true }));
  }
}

function renderCard(
  props: Partial<React.ComponentProps<typeof CatalogCard>> & { entry: CatalogEntry },
) {
  const view = render(
    <ul>
      <CatalogCard catalogVersion={CURRENT_CATALOG_VERSION} {...props} />
    </ul>,
  );
  return {
    ...view,
    stage: screen.getByTestId("catalog-card-stage"),
    replay: screen.getByRole("button", { name: `Replay ${props.entry.name}` }),
    // A replay mounts a fresh block, so this is always read anew.
    demo: () => screen.getByTestId("catalog-card-demo"),
  };
}

function styleOf(element: HTMLElement): string {
  return element.getAttribute("style") ?? "";
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CatalogCard", () => {
  it("names the animation and prints its defaults", () => {
    renderCard({ entry: fadeInUp });

    expect(screen.getByText("Fade In Up")).toBeInTheDocument();
    expect(screen.getByText("600ms · ease-out · distance 24px")).toBeInTheDocument();
  });

  it("plays the entry's own keyframes on mount", () => {
    const { demo } = renderCard({ entry: fadeInUp });

    expect(styleOf(demo())).toContain(
      `animation-name: ${keyframesName(fadeInUp.id, CURRENT_CATALOG_VERSION)}`,
    );
    expect(styleOf(demo())).toContain("animation-duration: 600ms");
    expect(styleOf(demo())).toContain("--vm-distance: 24px");
  });

  it("plays a hover-trigger entry on mount too — the page is a gallery", () => {
    const { demo } = renderCard({ entry: hoverLift });

    expect(styleOf(demo())).toContain(
      `animation-name: ${keyframesName(hoverLift.id, CURRENT_CATALOG_VERSION)}`,
    );
    // Hovering does nothing for a reader who asked for less motion, so the
    // hint is not offered to them either.
    expect(screen.getByText("Hover or focus to replay")).toHaveClass("motion-reduce:hidden");
  });

  it("offers no hover hint where hovering does nothing", () => {
    renderCard({ entry: fadeInUp });

    expect(screen.queryByText("Hover or focus to replay")).not.toBeInTheDocument();
  });

  it("replays on ↻ by mounting a fresh block", () => {
    const { demo, replay } = renderCard({ entry: fadeInUp });
    const before = demo();

    fireEvent.click(replay);

    expect(demo()).not.toBe(before);
    expect(styleOf(demo())).toContain(
      `animation-name: ${keyframesName(fadeInUp.id, CURRENT_CATALOG_VERSION)}`,
    );
  });

  it("marks a ↻ run as asked for, until it ends", () => {
    // The mark is what lets the run through the stylesheet's reduced-motion
    // rule; see components/help/reduced-motion.ts.
    const { demo, replay } = renderCard({ entry: fadeInUp });

    expect(demo()).toHaveAttribute("data-vm-demo");
    expect(demo()).not.toHaveAttribute("data-vm-replayed");

    fireEvent.click(replay);
    expect(demo()).toHaveAttribute("data-vm-replayed");

    endAnimation(demo());
    expect(demo()).not.toHaveAttribute("data-vm-replayed");
  });

  it("replays a hover-trigger entry on hover and on focus, without calling it explicit", () => {
    const { demo, stage, replay } = renderCard({ entry: hoverLift });
    const onMount = demo();

    fireEvent.mouseEnter(stage);
    expect(demo()).not.toBe(onMount);
    // Hovering is not a request to play: under reduced motion it stays quiet.
    expect(demo()).not.toHaveAttribute("data-vm-replayed");

    const afterHover = demo();
    fireEvent.focus(replay);
    expect(demo()).not.toBe(afterHover);
    expect(demo()).not.toHaveAttribute("data-vm-replayed");
  });

  it("leaves an entry that does not trigger on hover alone when hovered", () => {
    const { demo, stage } = renderCard({ entry: fadeInUp });
    const onMount = demo();

    fireEvent.mouseEnter(stage);

    expect(demo()).toBe(onMount);
  });

  it("survives a hover and a ↻ racing in the same frame", () => {
    const { demo, stage, replay } = renderCard({ entry: hoverLift });

    fireEvent.mouseEnter(stage);
    fireEvent.click(replay);
    fireEvent.mouseLeave(stage);

    const before = demo();
    fireEvent.click(replay);
    expect(demo()).not.toBe(before);
    expect(styleOf(demo())).toContain("animation-name");
  });

  it("caps an endless animation at one run when motion is unwelcome", () => {
    stubReducedMotion(true);
    const { demo } = renderCard({ entry: pulse });

    // Still driven by the catalog's keyframes — only the repeat is capped, so
    // an explicit ↻ always ends.
    expect(styleOf(demo())).toContain("animation-iteration-count: 1");
  });

  it("keeps the catalog's own repeat when motion is welcome", () => {
    const { demo } = renderCard({ entry: pulse });

    expect(styleOf(demo())).toContain("animation-iteration-count: infinite");
  });

  it("leaves suppressing autoplay to the stylesheet, not to hydration", () => {
    // The server cannot know the preference, so the inline style is
    // unconditional and `[data-vm-demo]:not([data-vm-replayed])` does the
    // suppressing — no flash of motion before the JS lands.
    stubReducedMotion(true);
    const { demo } = renderCard({ entry: fadeInUp });

    expect(styleOf(demo())).toContain("animation-name");
    expect(demo()).toHaveAttribute("data-vm-demo");
  });

  it("replays when the replay token changes, and counts that as explicit", () => {
    const { demo, rerender } = renderCard({ entry: hoverLift, replayToken: 0 });
    const before = demo();

    rerender(
      <ul>
        <CatalogCard entry={hoverLift} catalogVersion={CURRENT_CATALOG_VERSION} replayToken={1} />
      </ul>,
    );

    expect(demo()).not.toBe(before);
    expect(demo()).toHaveAttribute("data-vm-replayed");
  });
});
