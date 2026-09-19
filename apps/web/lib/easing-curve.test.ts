import { describe, expect, it } from "vitest";

import { easingCurvePath, parseEasing } from "./easing-curve";

describe("parseEasing", () => {
  it.each([
    ["linear", [0, 0, 1, 1]],
    ["ease", [0.25, 0.1, 0.25, 1]],
    ["ease-in", [0.42, 0, 1, 1]],
    ["ease-out", [0, 0, 0.58, 1]],
    ["ease-in-out", [0.42, 0, 0.58, 1]],
  ])("maps the CSS keyword %s to its standard curve", (keyword, expected) => {
    expect(parseEasing(keyword)).toEqual(expected);
  });

  it("ignores surrounding whitespace and case in a keyword", () => {
    expect(parseEasing("  Ease-Out ")).toEqual([0, 0, 0.58, 1]);
  });

  it("parses the handoff's spring, cubic-bezier(.34,1.56,.64,1)", () => {
    expect(parseEasing("cubic-bezier(.34,1.56,.64,1)")).toEqual([0.34, 1.56, 0.64, 1]);
  });

  it("parses a cubic-bezier with spaces and signs", () => {
    expect(parseEasing("cubic-bezier( -0.1 , 0.2, 0.3 , 1.4 )")).toEqual([-0.1, 0.2, 0.3, 1.4]);
  });

  it("returns null for an easing it cannot draw", () => {
    expect(parseEasing("steps(4, end)")).toBeNull();
    expect(parseEasing("cubic-bezier(0, 0, 1)")).toBeNull();
    expect(parseEasing("cubic-bezier(a, b, c, d)")).toBeNull();
    expect(parseEasing("")).toBeNull();
  });
});

describe("easingCurvePath", () => {
  it("draws a cubic through the control points, with y flipped for SVG", () => {
    // ease-in-out = cubic-bezier(.42, 0, .58, 1) in a 40x16 box: x scales by
    // the width, y by the height and counts up from the bottom.
    expect(easingCurvePath("ease-in-out", 40, 16)).toBe("M 0 16 C 16.8 16 23.2 0 40 0");
  });

  it("draws a straight diagonal for linear", () => {
    expect(easingCurvePath("linear", 40, 16)).toBe("M 0 16 C 0 16 40 0 40 0");
  });

  it("falls back to a straight line when the easing cannot be parsed", () => {
    expect(easingCurvePath("steps(4, end)", 40, 16)).toBe("M 0 16 L 40 0");
  });

  it("lets an overshooting spring leave the box, rather than clamping it", () => {
    // 1.56 is above the box: the y coordinate goes negative on purpose.
    expect(easingCurvePath("cubic-bezier(.34,1.56,.64,1)", 40, 16)).toBe(
      "M 0 16 C 13.6 -8.96 25.6 0 40 0",
    );
  });
});
