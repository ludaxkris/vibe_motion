import type { ElementInfo } from "bridge";
import { describe, expect, it } from "vitest";

import {
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
    const tieB = el({ tag: "li", order: 4 });
    expect(selectTargets([lostA, tieA, lostB, first, tieB]).targets).toEqual([first, tieA, tieB, lostA, lostB]);
  });

  it("does not treat <picture> as a target", () => {
    expect(TARGET_TAGS).not.toContain("picture");
    expect(skipReason(el({ tag: "picture" }))).toBe("not-semantic");
  });

  it("keeps nested targets (a link inside an article)", () => {
    const article = el({ tag: "article", order: 1 });
    const link = el({ tag: "a", order: 2 });
    expect(selectTargets([article, link]).targets).toEqual([article, link]);
  });
});

describe("TARGET_TAGS", () => {
  it("is lower-case, as the bridge filter expects", () => {
    for (const tag of TARGET_TAGS) expect(tag).toBe(tag.toLowerCase());
  });
});
