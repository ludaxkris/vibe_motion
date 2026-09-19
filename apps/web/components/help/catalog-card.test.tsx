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

/** Plays on load. */
const fadeInUp = entry("fade-in-up");
/** Plays on hover only. */
const hoverLift = entry("hover-lift");

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
    card: screen.getByTestId("catalog-card"),
    stage: screen.getByTestId("catalog-card-stage"),
    block: screen.getByTestId("catalog-card-demo"),
    replay: screen.getByRole("button", { name: `Replay ${props.entry.name}` }),
  };
}

function styleOf(element: HTMLElement): string {
  return element.getAttribute("style") ?? "";
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
    const { block } = renderCard({ entry: fadeInUp });

    expect(styleOf(block)).toContain(
      `animation-name: ${keyframesName(fadeInUp.id, CURRENT_CATALOG_VERSION)}`,
    );
    expect(styleOf(block)).toContain("animation-duration: 600ms");
    expect(styleOf(block)).toContain("--vm-distance: 24px");
  });

  it("replays by dropping the animation name and restoring it on the next frame", () => {
    const runFrames = stubAnimationFrames();
    const { block, replay } = renderCard({ entry: fadeInUp });
    const name = keyframesName(fadeInUp.id, CURRENT_CATALOG_VERSION);

    fireEvent.click(replay);
    expect(styleOf(block)).toContain("animation-name: none");

    runFrames();
    expect(styleOf(block)).toContain(`animation-name: ${name}`);
  });

  it("holds a hover-trigger entry still until the demo is hovered", () => {
    const { stage, block } = renderCard({ entry: hoverLift });

    expect(screen.getByText("Hover to play")).toBeInTheDocument();
    expect(styleOf(block)).not.toContain("animation-name");

    fireEvent.mouseEnter(stage);
    expect(styleOf(block)).toContain(
      `animation-name: ${keyframesName(hoverLift.id, CURRENT_CATALOG_VERSION)}`,
    );

    fireEvent.mouseLeave(stage);
    expect(styleOf(block)).not.toContain("animation-name");
  });

  it("plays a hover-trigger demo from the keyboard, when its replay button takes focus", () => {
    const { block, replay } = renderCard({ entry: hoverLift });

    fireEvent.focus(replay);
    expect(styleOf(block)).toContain("animation-name");

    fireEvent.blur(replay);
    expect(styleOf(block)).not.toContain("animation-name");
  });

  it("plays a hover-trigger entry when its replay button is pressed", () => {
    const { block, replay } = renderCard({ entry: hoverLift });

    fireEvent.click(replay);
    expect(styleOf(block)).toContain("animation-name");

    // The run ends where the hover would have ended it.
    endAnimation(block);
    expect(styleOf(block)).not.toContain("animation-name");
  });

  it("autoplays nothing under prefers-reduced-motion, but still replays on request", () => {
    stubReducedMotion(true);
    const { block, stage, replay } = renderCard({ entry: fadeInUp });

    expect(styleOf(block)).not.toContain("animation-name");

    // Hovering is not a request to play; pressing ↻ is.
    fireEvent.mouseEnter(stage);
    expect(styleOf(block)).not.toContain("animation-name");

    fireEvent.click(replay);
    expect(styleOf(block)).toContain("animation-name");
  });

  it("replays when the replay token changes, hover-trigger entries included", () => {
    const { block, rerender } = renderCard({ entry: hoverLift, replayToken: 0 });

    expect(styleOf(block)).not.toContain("animation-name");

    rerender(
      <ul>
        <CatalogCard entry={hoverLift} catalogVersion={CURRENT_CATALOG_VERSION} replayToken={1} />
      </ul>,
    );
    expect(styleOf(block)).toContain("animation-name");
  });
});
