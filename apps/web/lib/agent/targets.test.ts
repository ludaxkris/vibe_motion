import type { ElementInfo } from "bridge";
import { describe, expect, it } from "vitest";

import {
  CONTAINER_TAGS,
  isHoverTarget,
  MIN_TARGET_HEIGHT,
  MIN_TARGET_WIDTH,
  selectTargets,
  skipReason,
  TARGET_TAGS,
} from "./targets";

let nextId = 0;
function el(overrides: Partial<ElementInfo> = {}): ElementInfo {
  nextId += 1;
  const rect = { x: 0, y: 0, width: 200, height: 50 };
  return {
    vmId: `vm-${nextId}`,
    tag: "p",
    role: null,
    textPreview: "",
    rect,
    pageRect: rect,
    order: 0,
    visible: true,
    ...overrides,
  };
}

describe("skipReason", () => {
  it.each(["h2", "img", "a", "article"])("accepts <%s>", (tag) => {
    expect(skipReason(el({ tag }))).toBeNull();
  });

  it("skips a div as not-semantic", () => {
    expect(skipReason(el({ tag: "div" }))).toBe("not-semantic");
  });

  it("accepts a div with role=button", () => {
    expect(skipReason(el({ tag: "div", role: "button" }))).toBeNull();
  });

  it("skips a 39x200 h1 as too-small", () => {
    const pageRect = { x: 0, y: 0, width: 39, height: 200 };
    expect(skipReason(el({ tag: "h1", pageRect }))).toBe("too-small");
  });

  it("skips a 200x15 h1 as too-small", () => {
    const pageRect = { x: 0, y: 0, width: 200, height: 15 };
    expect(skipReason(el({ tag: "h1", pageRect }))).toBe("too-small");
  });

  // Found by the stack e2e: browser-default headings and one-line paragraphs
  // are under 40 px tall, and they are what Auto-generate exists for.
  it("accepts a one-line 600x18 p and a 300x28 h2", () => {
    expect(skipReason(el({ tag: "p", pageRect: { x: 0, y: 0, width: 600, height: 18 } }))).toBeNull();
    expect(skipReason(el({ tag: "h2", pageRect: { x: 0, y: 0, width: 300, height: 28 } }))).toBeNull();
  });

  it("accepts an element exactly MIN_TARGET_WIDTH x MIN_TARGET_HEIGHT (40x16)", () => {
    expect(MIN_TARGET_WIDTH).toBe(40);
    expect(MIN_TARGET_HEIGHT).toBe(16);
    const pageRect = { x: 0, y: 0, width: MIN_TARGET_WIDTH, height: MIN_TARGET_HEIGHT };
    expect(skipReason(el({ tag: "h1", pageRect }))).toBeNull();
  });

  it("checks hidden first", () => {
    const pageRect = { x: 0, y: 0, width: 1, height: 1 };
    expect(skipReason(el({ tag: "div", pageRect, visible: false }))).toBe("hidden");
  });
});

describe("isHoverTarget", () => {
  it("is true for button, a and role=button only", () => {
    expect(isHoverTarget(el({ tag: "button" }))).toBe(true);
    expect(isHoverTarget(el({ tag: "a" }))).toBe(true);
    expect(isHoverTarget(el({ tag: "div", role: "button" }))).toBe(true);
    expect(isHoverTarget(el({ tag: "h1" }))).toBe(false);
    expect(isHoverTarget(el({ tag: "img", role: "presentation" }))).toBe(false);
  });
});

describe("selectTargets", () => {
  it("splits targets from skipped, with a reason each", () => {
    const h2 = el({ tag: "h2", order: 1 });
    const div = el({ tag: "div", order: 2 });
    const hidden = el({ tag: "p", order: 3, visible: false });
    const { targets, skipped } = selectTargets([h2, div, hidden]);
    expect(targets).toEqual([h2]);
    expect(skipped).toEqual([
      { vmId: div.vmId, reason: "not-semantic" },
      { vmId: hidden.vmId, reason: "hidden" },
    ]);
  });

  it("sorts targets by document order and leaves the input alone", () => {
    const c = el({ tag: "h3", order: 30 });
    const a = el({ tag: "h1", order: 10 });
    const b = el({ tag: "img", order: 20 });
    const input = [c, a, b];
    expect(selectTargets(input).targets).toEqual([a, b, c]);
    expect(input).toEqual([c, a, b]);
  });

  it("sorts the bridge's order -1 sentinel last, ties in input order", () => {
    const lostA = el({ tag: "h1", order: -1 });
    const first = el({ tag: "h2", order: 0 });
    const lostB = el({ tag: "h3", order: -1 });
    const tieA = el({ tag: "p", order: 4 });
    // Not a container tag: every `el()` here shares one rect, and a container
    // would (rightly) nest the identical boxes sorted after it.
    const tieB = el({ tag: "img", order: 4 });
    expect(selectTargets([lostA, tieA, lostB, first, tieB]).targets).toEqual([first, tieA, tieB, lostA, lostB]);
  });

  it("does not treat <picture> as a target", () => {
    expect(TARGET_TAGS).not.toContain("picture");
    expect(skipReason(el({ tag: "picture" }))).toBe("not-semantic");
  });

  it("keeps a link inside an article: hover targets are never nested", () => {
    const article = el({ tag: "article", order: 1 });
    const link = el({ tag: "a", order: 2 });
    expect(selectTargets([article, link]).targets).toEqual([article, link]);
  });
});

/** A box on the page; `el()`'s default rect is shared, so nesting tests always pass their own. */
function box(x: number, y: number, width: number, height: number) {
  const rect = { x, y, width, height };
  return { rect, pageRect: rect };
}

describe("selectTargets: a container block animates as one unit", () => {
  it("names the container tags", () => {
    expect(CONTAINER_TAGS).toEqual(["article", "figure", "li", "blockquote"]);
  });

  it("skips entrance targets inside an article as nested, and keeps its link", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 100, 300, 200) });
    const h2 = el({ tag: "h2", order: 2, ...box(16, 116, 268, 28) });
    const p = el({ tag: "p", order: 3, ...box(16, 160, 268, 24) });
    const link = el({ tag: "a", order: 4, ...box(16, 200, 120, 40) });
    const button = el({ tag: "div", role: "button", order: 5, ...box(150, 200, 120, 40) });
    const { targets, skipped } = selectTargets([article, h2, p, link, button]);
    expect(targets).toEqual([article, link, button]);
    expect(skipped).toEqual([
      { vmId: h2.vmId, reason: "nested" },
      { vmId: p.vmId, reason: "nested" },
    ]);
  });

  it("keeps a heading that merely overlaps a container's edge", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 100, 300, 200) });
    const h2 = el({ tag: "h2", order: 2, ...box(16, 90, 268, 28) });
    expect(selectTargets([article, h2]).targets).toEqual([article, h2]);
  });

  it("allows half a pixel of rounding on every edge, and no more", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 100, 300, 200) });
    const within = el({ tag: "p", order: 2, ...box(-0.5, 99.5, 301, 201) });
    const beyond = el({ tag: "p", order: 3, ...box(-0.6, 100, 100, 50) });
    // `within` is larger than the article, so the area rule keeps it; `beyond`
    // pokes out by more than the tolerance; `snug` pokes out by exactly 0.5 px.
    const snug = el({ tag: "p", order: 4, ...box(-0.5, 100, 200, 50) });
    const { targets } = selectTargets([article, within, beyond, snug]);
    expect(targets).toEqual([article, within, beyond]);
  });

  it("figure > img: the figure stays, the img is nested", () => {
    const figure = el({ tag: "figure", order: 1, ...box(0, 0, 400, 300) });
    const img = el({ tag: "img", order: 2, ...box(0, 0, 400, 260) });
    const { targets, skipped } = selectTargets([figure, img]);
    expect(targets).toEqual([figure]);
    expect(skipped).toEqual([{ vmId: img.vmId, reason: "nested" }]);
  });

  it("identical rects: the earlier order is kept, and they never eliminate each other", () => {
    const li = el({ tag: "li", order: 1, ...box(0, 0, 300, 24) });
    const p = el({ tag: "p", order: 2, ...box(0, 0, 300, 24) });
    expect(selectTargets([p, li]).targets).toEqual([li]);

    const first = el({ tag: "li", order: 1, ...box(0, 0, 300, 24) });
    const second = el({ tag: "li", order: 2, ...box(0, 0, 300, 24) });
    expect(selectTargets([second, first]).targets).toEqual([first]);

    const heading = el({ tag: "h2", order: 1, ...box(0, 0, 300, 24) });
    const wrapper = el({ tag: "article", order: 2, ...box(0, 0, 300, 24) });
    expect(selectTargets([heading, wrapper]).targets).toEqual([heading, wrapper]);
  });

  it("a container inside a container: only the outermost stays", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 0, 600, 400) });
    const li = el({ tag: "li", order: 2, ...box(20, 20, 560, 100) });
    const p = el({ tag: "p", order: 3, ...box(30, 30, 500, 24) });
    const { targets, skipped } = selectTargets([article, li, p]);
    expect(targets).toEqual([article]);
    expect(skipped.map((s) => s.reason)).toEqual(["nested", "nested"]);
  });

  it("leaves an h1 outside any container alone", () => {
    const h1 = el({ tag: "h1", order: 1, ...box(0, 0, 600, 37) });
    const article = el({ tag: "article", order: 2, ...box(0, 100, 300, 200) });
    expect(selectTargets([h1, article]).targets).toEqual([h1, article]);
  });

  it("a non-container never nests anything (h2 inside a big p)", () => {
    const p = el({ tag: "p", order: 1, ...box(0, 0, 600, 400) });
    const h2 = el({ tag: "h2", order: 2, ...box(10, 10, 100, 28) });
    expect(selectTargets([p, h2]).targets).toEqual([p, h2]);
  });

  it("a container that is itself skipped (too small, hidden) nests nothing", () => {
    const hidden = el({ tag: "article", order: 1, visible: false, ...box(0, 0, 600, 400) });
    const h2 = el({ tag: "h2", order: 2, ...box(10, 10, 100, 28) });
    expect(selectTargets([hidden, h2]).targets).toEqual([h2]);
  });

  it("does not depend on input order", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 100, 300, 200) });
    const h2 = el({ tag: "h2", order: 2, ...box(16, 116, 268, 28) });
    const link = el({ tag: "a", order: 3, ...box(16, 200, 120, 40) });
    const outside = el({ tag: "h1", order: 0, ...box(0, 0, 600, 37) });
    const expected = selectTargets([outside, article, h2, link]);
    expect(expected.targets).toEqual([outside, article, link]);
    expect(selectTargets([link, h2, outside, article])).toEqual(expected);
  });
});

describe("selectTargets: blocks the agent may not assign still nest their children", () => {
  it("a block-only article nests its h2 and p, and appears in neither list", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 100, 300, 200) });
    const h2 = el({ tag: "h2", order: 2, ...box(16, 116, 268, 28) });
    const p = el({ tag: "p", order: 3, ...box(16, 160, 268, 24) });
    const link = el({ tag: "a", order: 4, ...box(16, 200, 120, 40) });
    const { targets, skipped } = selectTargets([h2, p, link], { blocks: [article] });
    expect(targets).toEqual([link]);
    expect(skipped).toEqual([
      { vmId: h2.vmId, reason: "nested" },
      { vmId: p.vmId, reason: "nested" },
    ]);
  });

  it("a block never appears in targets or skipped, whatever is wrong with it", () => {
    const fine = el({ tag: "article", order: 1, ...box(0, 0, 300, 200) });
    const hidden = el({ tag: "figure", order: 2, visible: false, ...box(0, 300, 300, 200) });
    const tiny = el({ tag: "li", order: 3, ...box(0, 600, 10, 10) });
    const div = el({ tag: "div", order: 4, ...box(0, 700, 300, 200) });
    const h1 = el({ tag: "h1", order: 5, ...box(0, 1000, 300, 37) });
    const { targets, skipped } = selectTargets([h1], { blocks: [fine, hidden, tiny, div] });
    expect(targets).toEqual([h1]);
    expect(skipped).toEqual([]);
  });

  it("a block that is not a container tag, is hidden, or is a hover target nests nothing", () => {
    const heading = el({ tag: "h1", order: 1, ...box(0, 0, 600, 400) });
    const hidden = el({ tag: "article", order: 2, visible: false, ...box(0, 0, 600, 400) });
    const button = el({ tag: "li", role: "button", order: 3, ...box(0, 0, 600, 400) });
    const p = el({ tag: "p", order: 4, ...box(10, 10, 200, 24) });
    expect(selectTargets([p], { blocks: [heading, hidden, button] }).targets).toEqual([p]);
  });

  it("a candidate container inside a block is nested too", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 0, 600, 400) });
    const figure = el({ tag: "figure", order: 2, ...box(20, 20, 300, 200) });
    const img = el({ tag: "img", order: 3, ...box(20, 20, 300, 160) });
    const { targets, skipped } = selectTargets([figure, img], { blocks: [article] });
    expect(targets).toEqual([]);
    expect(skipped.map((s) => s.reason)).toEqual(["nested", "nested"]);
  });

  it("an element listed both ways is judged as an element", () => {
    const article = el({ tag: "article", order: 1, ...box(0, 0, 600, 400) });
    expect(selectTargets([article], { blocks: [article] }).targets).toEqual([article]);
  });
});

describe("selectTargets: an entrance element taller than the viewport is too-large", () => {
  const viewport = { width: 1280, height: 600 };

  function post(top: number) {
    const article = el({ tag: "article", order: 0, ...box(40, top, 1200, 5000) });
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      el({ tag: "p", order: i + 1, ...box(60, top + 20 + i * 240, 1160, 200) }),
    );
    return { article, paragraphs };
  }

  it.each([
    ["at load position", 0],
    ["below the fold", 900],
  ])("a 1200x5000 article wrapping 20 paragraphs, %s: the paragraphs are the targets", (_name, top) => {
    const { article, paragraphs } = post(top);
    const { targets, skipped } = selectTargets([article, ...paragraphs], { viewport });
    expect(targets).toEqual(paragraphs);
    expect(skipped).toEqual([{ vmId: article.vmId, reason: "too-large" }]);
  });

  it("a too-large block nests nothing either", () => {
    const { article, paragraphs } = post(0);
    expect(selectTargets(paragraphs, { blocks: [article], viewport }).targets).toEqual(paragraphs);
  });

  it("a 1200x500 card still nests its children", () => {
    const card = el({ tag: "article", order: 0, ...box(40, 0, 1200, 500) });
    const h2 = el({ tag: "h2", order: 1, ...box(60, 20, 600, 28) });
    const p = el({ tag: "p", order: 2, ...box(60, 60, 1160, 200) });
    const { targets, skipped } = selectTargets([card, h2, p], { viewport });
    expect(targets).toEqual([card]);
    expect(skipped.map((s) => s.reason)).toEqual(["nested", "nested"]);
  });

  it("exactly the viewport's height is not too large", () => {
    const card = el({ tag: "article", order: 0, ...box(0, 0, 1200, 600) });
    expect(selectTargets([card], { viewport }).targets).toEqual([card]);
  });

  it("never applies to a hover target", () => {
    const link = el({ tag: "a", order: 0, ...box(0, 0, 1200, 5000) });
    expect(selectTargets([link], { viewport }).targets).toEqual([link]);
  });

  it("is off without a viewport", () => {
    const { article, paragraphs } = post(0);
    const { targets } = selectTargets([article, ...paragraphs]);
    expect(targets).toEqual([article]);
  });

  it("too-small, hidden and not-semantic are reported first", () => {
    const hidden = el({ tag: "article", order: 0, visible: false, ...box(0, 0, 1200, 5000) });
    const narrow = el({ tag: "article", order: 1, ...box(0, 0, 10, 5000) });
    expect(selectTargets([hidden, narrow], { viewport }).skipped.map((s) => s.reason)).toEqual([
      "hidden",
      "too-small",
    ]);
  });
});

describe("TARGET_TAGS", () => {
  it("is lower-case, as the bridge filter expects", () => {
    for (const tag of TARGET_TAGS) expect(tag).toBe(tag.toLowerCase());
  });
});
