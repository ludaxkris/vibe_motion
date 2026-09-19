import { describe, expect, it } from "vitest";

import type { CatalogEntry, CatalogParam } from "@/lib/api-client";
import { defaultsLine } from "@/lib/catalog-defaults";
import { getCatalogEntry } from "@/lib/catalog";

const entry = (id: string): CatalogEntry => {
  const found = getCatalogEntry(id);
  if (!found) throw new Error(`no catalog entry "${id}"`);
  return found;
};

/** A real entry with its params swapped, for the cases the catalog has no example of. */
function withParams(params: CatalogParam[]): CatalogEntry {
  return { ...entry("fade-in"), params };
}

describe("defaultsLine", () => {
  it("reads the handoff's line off the entry: bare standard values, then key + value", () => {
    // docs/design/ui_kit/Help.jsx: "600ms · ease-out · distance 24px".
    expect(defaultsLine(entry("fade-in-up"))).toBe("600ms · ease-out · distance 24px");
  });

  it("drops a zero delay, a single iteration, a normal direction and fillMode always", () => {
    // spin: 2000ms / 0ms / linear / infinite / normal / none.
    expect(defaultsLine(entry("spin"))).toBe("2000ms · linear · infinite");
    // shake: 700ms / 0ms / ease-in-out / 1 / none / distance 8px.
    expect(defaultsLine(entry("shake"))).toBe("700ms · ease-in-out · distance 8px");
    // fade-in has nothing but the four standard params.
    expect(defaultsLine(entry("fade-in"))).toBe("600ms · ease-out");
  });

  it("keeps a delay, an iteration and a direction that are not the quiet default", () => {
    const line = defaultsLine(
      withParams([
        { key: "duration", type: "duration", default: "600ms" },
        { key: "delay", type: "duration", default: "120ms" },
        { key: "easing", type: "easing", default: "ease-out" },
        { key: "iteration", type: "iteration", default: "2" },
        { key: "direction", type: "direction", default: "alternate" },
        { key: "fillMode", type: "select", default: "both" },
      ]),
    );

    expect(line).toBe("600ms · 120ms · ease-out · 2 · alternate");
  });

  it("keeps every param in catalog order, standard or not", () => {
    expect(defaultsLine(entry("glow"))).toBe(
      "1600ms · ease-in-out · infinite · color rgba(99, 102, 241, 0.6) · radius 16px",
    );
  });

  it("is empty when nothing survives the skip rules", () => {
    expect(defaultsLine(withParams([{ key: "fillMode", type: "select", default: "both" }]))).toBe(
      "",
    );
  });
});
