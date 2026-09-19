import { describe, expect, it } from "vitest";

import { createRng, pick } from "./rng";

describe("createRng", () => {
  it("is deterministic per seed and stays in [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const c = createRng(43);
    const seqA = [a(), a(), a()];
    const seqB = [b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual([c(), c(), c()]);
    for (const n of seqA) {
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(1);
    }
  });
});

describe("pick", () => {
  it("returns the item the rng points at", () => {
    const items = ["a", "b", "c", "d"];
    expect(pick(() => 0, items)).toBe("a");
    expect(pick(() => 0.5, items)).toBe("c");
    expect(pick(() => 0.999, items)).toBe("d");
  });

  it("throws on an empty list", () => {
    expect(() => pick(() => 0, [])).toThrow(/empty/);
  });
});
