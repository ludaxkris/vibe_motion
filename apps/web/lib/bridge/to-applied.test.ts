import { CATALOGS, getEntry, type CatalogVersion } from "animation-catalog";
import { validateApplied } from "bridge";
import { describe, expect, it } from "vitest";

import type { Assignment } from "@/lib/api-client";

import { isUnresolved, toApplied } from "./to-applied";

function assignment(overrides: Partial<Assignment> = {}): Assignment {
  return {
    animationId: "fade-in-up",
    catalogVersion: "1.1.0",
    trigger: "load",
    params: {},
    ...overrides,
  };
}

describe("toApplied", () => {
  it("resolves an assignment against the catalog version it pinned", () => {
    const applied = toApplied("vm-heading", assignment());
    if (isUnresolved(applied)) throw new Error(`unexpectedly unresolved: ${applied.reason}`);

    expect(applied.vmId).toBe("vm-heading");
    expect(applied.trigger).toBe("load");
    expect(applied.keyframesName).toBe("vm-fade-in-up-v1-1-0");
    expect(applied.keyframesCss).toContain("@keyframes vm-fade-in-up-v1-1-0");
    expect(applied.animationId).toBe("fade-in-up");
    expect(applied.catalogVersion).toBe("1.1.0");
  });

  it("puts the param-driven longhands and custom properties in `style`, never animation-name", () => {
    const applied = toApplied("vm-heading", assignment());
    if (isUnresolved(applied)) throw new Error("unexpectedly unresolved");

    expect(applied.style).toMatchObject({
      "animation-duration": expect.any(String),
      "animation-fill-mode": expect.any(String),
      "--vm-distance": expect.any(String),
    });
    expect(applied.style).not.toHaveProperty("animation-name");
  });

  it("resolves each assignment against its OWN pin, not the current catalog", () => {
    const old = toApplied("vm-heading", assignment({ catalogVersion: "1.0.0" }));
    if (isUnresolved(old)) throw new Error("unexpectedly unresolved");

    // 1.1.0 gave every entry a `fillMode` param that 1.0.0 has none of, and the
    // keyframes name carries the full version, so the two never collide.
    expect(old.keyframesName).toBe("vm-fade-in-up-v1-0-0");
    expect(old.style).not.toHaveProperty("animation-fill-mode");
    expect(old.params).not.toHaveProperty("fillMode");
  });

  it("carries the entry's baseStyles as a string and keeps them out of `style`", () => {
    const applied = toApplied("vm-card", assignment({ animationId: "flip-in-x" }));
    if (isUnresolved(applied)) throw new Error("unexpectedly unresolved");

    const entry = getEntry("1.1.0", "flip-in-x");
    expect(entry?.baseStyles).toBeTruthy();
    expect(applied.baseStyles).toBe(entry?.baseStyles);
    // `backface-visibility` is a base style; it travels in the rule the bridge
    // writes, never in the inline animation group.
    expect(applied.style).not.toHaveProperty("backface-visibility");
  });

  it("uses catalog defaults for params the draft does not set, and the draft's where it does", () => {
    const withDefaults = toApplied("vm-heading", assignment());
    const tuned = toApplied("vm-heading", assignment({ params: { duration: "1200ms" } }));
    if (isUnresolved(withDefaults) || isUnresolved(tuned)) throw new Error("unexpectedly unresolved");

    expect(tuned.params.duration).toBe("1200ms");
    expect(tuned.style["animation-duration"]).toBe("1200ms");
    // Everything else still comes from the entry.
    expect(tuned.params.easing).toBe(withDefaults.params.easing);
  });

  it("reports an unknown catalog version rather than guessing one", () => {
    const result = toApplied("vm-heading", assignment({ catalogVersion: "9.9.9" }));
    expect(isUnresolved(result)).toBe(true);
    expect(result).toMatchObject({
      vmId: "vm-heading",
      reason: "unknown-version",
      animationId: "fade-in-up",
      catalogVersion: "9.9.9",
    });
  });

  it("reports an animation the pinned version does not have", () => {
    const result = toApplied("vm-heading", assignment({ animationId: "does-not-exist" }));
    expect(isUnresolved(result)).toBe(true);
    expect(result).toMatchObject({ reason: "unknown-animation", animationId: "does-not-exist" });
  });

  it("produces a payload the bridge accepts for every (version, id) in the catalog", () => {
    const seen: string[] = [];
    for (const [version, catalog] of Object.entries(CATALOGS) as [CatalogVersion, (typeof CATALOGS)[CatalogVersion]][]) {
      for (const entry of catalog.entries) {
        const applied = toApplied("vm-1", {
          animationId: entry.id,
          catalogVersion: version,
          trigger: entry.defaultTrigger ?? entry.triggers[0],
          params: {},
        });
        if (isUnresolved(applied)) throw new Error(`${version}/${entry.id}: ${applied.reason}`);
        expect(validateApplied(applied), `${version}/${entry.id}`).toBe(true);
        seen.push(`${version}/${entry.id}`);
      }
    }
    expect(seen.length).toBeGreaterThan(0);
  });
});
