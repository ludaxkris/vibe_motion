import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EditorStateMap } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";

import { IdlePanel } from "./idle";

function draftWith(vmId: string, animationId: string): EditorStateMap {
  const entry = getCatalogEntry(animationId)!;
  return {
    [vmId]: {
      animationId: entry.id,
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger ?? entry.triggers[0],
      params: resolveCatalogParams(entry),
    },
  };
}

describe("IdlePanel", () => {
  it("invites the user to click an element, and says how to get back out", () => {
    render(<IdlePanel assignments={{}} />);

    expect(screen.getByTestId("panel-idle")).toBeInTheDocument();
    expect(screen.getByText("Click any element to animate it")).toBeInTheDocument();
    expect(screen.getByText(/hover outlines the element/i)).toBeInTheDocument();
    // Esc reads as a key, not as prose.
    expect(screen.getByText("Esc").tagName).toBe("KBD");
  });

  it("offers the whole-page prompt, with auto-generate still to come", () => {
    render(<IdlePanel assignments={{}} />);

    expect(screen.getByText("Whole page")).toBeInTheDocument();
    const prompt = screen.getByLabelText("Describe the feel");
    expect(prompt.tagName).toBe("TEXTAREA");
    expect(prompt).toHaveAttribute(
      "placeholder",
      "Describe the feel — 'calm, staggered entrances, nothing loops'",
    );
    expect(screen.getByRole("button", { name: "Auto-generate for this page" })).toBeDisabled();
    expect(screen.getByText(/arrives with the mock agent/i)).toBeInTheDocument();
  });

  it("hides the animated list until something is animated", () => {
    render(<IdlePanel assignments={{}} />);

    expect(screen.queryByText(/^Animated ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /replay all/i })).not.toBeInTheDocument();
  });

  it("lists every animated element with its animation and meta, and counts them", () => {
    render(<IdlePanel assignments={{ ...draftWith("vm-3", "fade-in-up"), ...draftWith("vm-9", "pulse") }} />);

    expect(screen.getByText("Animated · 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fade In Up on vm-3/ })).toBeInTheDocument();
    expect(screen.getByText("vm-3")).toBeInTheDocument();
    expect(screen.getByText("load · 600ms · 0ms")).toBeInTheDocument();
  });

  it("selects the element a row names when the row is clicked", () => {
    const onSelectElement = vi.fn();
    render(<IdlePanel assignments={draftWith("vm-3", "fade-in-up")} onSelectElement={onSelectElement} />);

    fireEvent.click(screen.getByRole("button", { name: /Fade In Up on vm-3/ }));

    expect(onSelectElement).toHaveBeenCalledWith("vm-3");
  });

  it("names a row's animation from the version that row's assignment pinned", () => {
    render(
      <IdlePanel
        assignments={{
          "vm-3": {
            animationId: "fade-in-up",
            // A version this browser has no catalog for: the id is the honest
            // label, rather than the *current* catalog's name for an entry
            // this assignment was never authored against.
            catalogVersion: "9.9.9",
            trigger: "load",
            params: { duration: "600ms", delay: "0ms" },
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /fade-in-up on vm-3/ })).toBeInTheDocument();
    expect(screen.queryByText("Fade In Up")).not.toBeInTheDocument();
  });

  it("keeps Replay all disabled until the preview bridge exists", () => {
    render(<IdlePanel assignments={draftWith("vm-3", "fade-in-up")} />);

    expect(screen.getByRole("button", { name: "Replay all" })).toBeDisabled();
  });
});
