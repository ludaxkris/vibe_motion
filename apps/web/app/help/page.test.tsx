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
});
