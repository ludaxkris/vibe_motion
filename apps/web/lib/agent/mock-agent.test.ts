import { CURRENT_VERSION, getEntry, type CatalogEntry } from "animation-catalog";
import type { ElementInfo } from "bridge";
import { describe, expect, it } from "vitest";

import type { Assignment } from "@/lib/api-client";

import { EXCLUDED_ANIMATION_IDS } from "./constants";
import { filterPool, MockAnimationAgent } from "./mock-agent";
import type { PageContext } from "./types";

const viewport = { width: 1280, height: 800 };

function el(vmId: string, tag: string, y: number, order: number, overrides: Partial<ElementInfo> = {}): ElementInfo {
  const pageRect = { x: 0, y, width: 200, height: 50 };
  return { vmId, tag, role: null, textPreview: "", rect: pageRect, pageRect, order, visible: true, ...overrides };
}

function pageCtx(elements: ElementInfo[], overrides: Partial<PageContext> = {}): PageContext {
  return { elements, existing: {}, prompt: "", viewport, catalogVersion: CURRENT_VERSION, ...overrides };
}

const PAGE: ElementInfo[] = [
  el("h1", "h1", 100, 0),
  el("img", "img", 300, 1),
  el("a", "a", 400, 2),
  el("p", "p", 1500, 3),
  el("div", "div", 1600, 4),
];

const SEEDS_50 = Array.from({ length: 50 }, (_, i) => i + 1);

function entryOf(a: Assignment): CatalogEntry {
  const entry = getEntry(a.catalogVersion, a.animationId);
  if (!entry) throw new Error(`no catalog entry for ${a.animationId}@${a.catalogVersion}`);
  return entry;
}

function defaultDelay(a: Assignment): string | undefined {
  return entryOf(a).params.find((p) => p.key === "delay")?.default;
}

function at<T>(record: Record<string, T>, key: string): T {
  const value = record[key];
  if (value === undefined) throw new Error(`missing ${key}`);
  return value;
}

describe("MockAnimationAgent determinism", () => {
  it("gives the same suggestion for the same seed and context", async () => {
    const a = await new MockAnimationAgent(7).suggestForPage(pageCtx(PAGE));
    const b = await new MockAnimationAgent(7).suggestForPage(pageCtx(PAGE));
    expect(a).toEqual(b);
  });

  it("varies across seeds", async () => {
    const results = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      results.add(JSON.stringify(await new MockAnimationAgent(seed).suggestForPage(pageCtx(PAGE))));
    }
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it("ignores existing assignments and the prompt", async () => {
    const bare = await new MockAnimationAgent(11).suggestForPage(pageCtx(PAGE));
    const existing: Record<string, Assignment> = {
      other: { animationId: "pulse", catalogVersion: CURRENT_VERSION, trigger: "load", params: {} },
    };
    const withContext = await new MockAnimationAgent(11).suggestForPage(
      pageCtx(PAGE, { existing, prompt: "make it playful" }),
    );
    expect(withContext).toEqual(bare);
  });
});

describe("MockAnimationAgent.suggestForPage heuristics", () => {
  it.each(SEEDS_50)("seed %i: categories, triggers, exclusions, skips", async (seed) => {
    const { assignments, skipped } = await new MockAnimationAgent(seed).suggestForPage(pageCtx(PAGE));

    expect(Object.keys(assignments).sort()).toEqual(["a", "h1", "img", "p"]);
    expect(skipped).toEqual([{ vmId: "div", reason: "not-semantic" }]);

    for (const vmId of ["h1", "img", "p"]) {
      expect(entryOf(at(assignments, vmId)).category).toBe("entrance");
    }
    expect(entryOf(at(assignments, "a")).category).toBe("hover");
    expect(at(assignments, "a").trigger).toBe("hover");

    for (const a of Object.values(assignments)) {
      expect(entryOf(a).category).not.toBe("exit");
      expect(EXCLUDED_ANIMATION_IDS).not.toContain(a.animationId);
    }

    expect(at(assignments, "h1").trigger).toBe("load");
    expect(at(assignments, "img").trigger).toBe("load");
    expect(at(assignments, "p").trigger).toBe("in-view");
  });

  it.each(SEEDS_50)("seed %i: every assignment honours the catalog contract", async (seed) => {
    const { assignments } = await new MockAnimationAgent(seed).suggestForPage(pageCtx(PAGE));
    for (const a of Object.values(assignments)) {
      const entry = entryOf(a);
      expect(a.catalogVersion).toBe(CURRENT_VERSION);
      expect(entry.triggers).toContain(a.trigger);
      expect(Object.keys(a.params).sort()).toEqual(entry.params.map((p) => p.key).sort());
    }
  });

  it("uses role=button as a hover target", async () => {
    const { assignments } = await new MockAnimationAgent(3).suggestForPage(
      pageCtx([el("cta", "div", 100, 0, { role: "button" })]),
    );
    expect(entryOf(at(assignments, "cta")).category).toBe("hover");
    expect(at(assignments, "cta").trigger).toBe("hover");
  });

  it("treats an element starting exactly at the fold as below it", async () => {
    const { assignments } = await new MockAnimationAgent(3).suggestForPage(
      pageCtx([el("edge", "h2", viewport.height, 0)]),
    );
    expect(at(assignments, "edge").trigger).toBe("in-view");
  });
});

describe("MockAnimationAgent stagger", () => {
  it("steps load entrances by 60ms in document order, skipping hover and in-view", async () => {
    const { assignments } = await new MockAnimationAgent(5).suggestForPage(pageCtx(PAGE));
    expect(at(assignments, "h1").params.delay).toBe("0ms");
    expect(at(assignments, "img").params.delay).toBe("60ms");
    const p = at(assignments, "p");
    expect(p.params.delay).toBe(defaultDelay(p));
    const a = at(assignments, "a");
    expect(a.params.delay).toBe(defaultDelay(a));
  });

  it("follows document order, not input order", async () => {
    const { assignments } = await new MockAnimationAgent(5).suggestForPage(
      pageCtx([el("second", "h2", 200, 9), el("first", "h1", 100, 1)]),
    );
    expect(at(assignments, "first").params.delay).toBe("0ms");
    expect(at(assignments, "second").params.delay).toBe("60ms");
  });

  it("caps the stagger at 600ms", async () => {
    const headings = Array.from({ length: 15 }, (_, i) => el(`h-${i}`, "h2", 10 + i * 50, i));
    const { assignments } = await new MockAnimationAgent(9).suggestForPage(pageCtx(headings));
    expect(at(assignments, "h-0").params.delay).toBe("0ms");
    expect(at(assignments, "h-10").params.delay).toBe("600ms");
    expect(at(assignments, "h-14").params.delay).toBe("600ms");
  });
});

describe("MockAnimationAgent.suggestForElement", () => {
  const shared = { existing: {}, prompt: "", viewport, catalogVersion: CURRENT_VERSION };

  it("gives a link a hover animation", async () => {
    const a = await new MockAnimationAgent(1).suggestForElement({ ...shared, element: el("a", "a", 100, 0) });
    expect(entryOf(a).category).toBe("hover");
    expect(a.trigger).toBe("hover");
  });

  it("gives a heading below the fold an in-view entrance with the default delay", async () => {
    const a = await new MockAnimationAgent(1).suggestForElement({ ...shared, element: el("h2", "h2", 2000, 0) });
    expect(entryOf(a).category).toBe("entrance");
    expect(a.trigger).toBe("in-view");
    expect(a.params.delay).toBe(defaultDelay(a));
  });

  it("still animates an element that is not a page target: the user asked for it", async () => {
    const a = await new MockAnimationAgent(1).suggestForElement({ ...shared, element: el("div", "div", 100, 0) });
    expect(entryOf(a).category).toBe("entrance");
    expect(a.trigger).toBe("load");
    expect(a.params.delay).toBe("0ms");
  });
});

describe("filterPool", () => {
  function entry(id: string, category: CatalogEntry["category"]): CatalogEntry {
    const base = getEntry(CURRENT_VERSION, "fade-in");
    if (!base) throw new Error("fade-in is missing from the catalog");
    return { ...base, id, category };
  }

  it("keeps the category and drops excluded ids", () => {
    // Synthetic: the live entrance/hover pools never contain an excluded id.
    const synthetic = [
      entry("fade-in", "entrance"),
      entry("shimmer", "entrance"),
      entry("underline-sweep", "entrance"),
      entry("hover-lift", "hover"),
    ];
    expect(filterPool(synthetic, "entrance").map((e) => e.id)).toEqual(["fade-in"]);
    expect(filterPool(synthetic, "hover").map((e) => e.id)).toEqual(["hover-lift"]);
  });
});
