import { render, screen } from "@testing-library/react";
import { keyframesName } from "animation-catalog";
import { describe, expect, it } from "vitest";

import { CURRENT_CATALOG_VERSION, getCatalogEntries } from "@/lib/catalog";

import HelpPage from "./page";

const entries = getCatalogEntries();

describe("help page", () => {
  it("shows every animation in the current catalog", () => {
    render(<HelpPage />);

    expect(screen.getAllByTestId("catalog-card")).toHaveLength(entries.length);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Animation catalog");
    expect(screen.getByText(`catalog ${CURRENT_CATALOG_VERSION}`)).toBeInTheDocument();
  });

  it("emits one runtime stylesheet carrying every entry's keyframes", () => {
    render(<HelpPage />);

    const style = document.getElementById("vm-runtime");
    expect(style).not.toBeNull();

    const css = style?.textContent ?? "";
    for (const entry of entries) {
      expect(css).toContain(`@keyframes ${keyframesName(entry.id, CURRENT_CATALOG_VERSION)}`);
    }
  });

  it("suppresses the demos in that stylesheet, so no motion beats hydration", () => {
    // The server cannot read `prefers-reduced-motion`, so the suppression has
    // to be a rule the browser applies before any JavaScript runs.
    render(<HelpPage />);

    const css = document.getElementById("vm-runtime")?.textContent ?? "";
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("[data-vm-demo]:not([data-vm-replayed])");
    expect(css).toContain("animation-name: none !important");
    // …and the baseStyles paint that only reads as itself mid-animation; see
    // components/help/reduced-motion.ts.
    expect(css).toContain("background-image: none !important");
  });

  it("carries nothing through <style> that React would have to escape", () => {
    // `<style>` is raw text: React escapes `<`, `>` and `&` in a text child,
    // so a catalog string containing one would land in the CSS as `&lt;` and
    // break the rule. Nothing in the catalog does — keep it that way.
    for (const entry of entries) {
      expect(entry.keyframes, `${entry.id} keyframes`).not.toMatch(/[<>&]/);
      for (const param of entry.params) {
        expect(param.default, `${entry.id}.${param.key} default`).not.toMatch(/[<>&]/);
      }
    }
  });
});
