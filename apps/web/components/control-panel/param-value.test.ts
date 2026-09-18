import { describe, expect, it } from "vitest";

import { joinValue, splitValue } from "./param-value";

describe("splitValue", () => {
  it.each([
    ["600ms", 600, "ms"],
    ["0ms", 0, "ms"],
    ["24px", 24, "px"],
    ["-90deg", -90, "deg"],
    ["45deg", 45, "deg"],
    ["50%", 50, "%"],
    ["1.2", 1.2, ""],
    ["0.05", 0.05, ""],
  ])("splits %s into amount %s and unit %s", (value, amount, unit) => {
    expect(splitValue(value)).toEqual({ amount, unit });
  });
});

describe("joinValue", () => {
  it.each([
    [600, "ms", "600ms"],
    [0, "ms", "0ms"],
    [-90, "deg", "-90deg"],
    [50, "%", "50%"],
    [1.2, "", "1.2"],
  ])("joins %s and %s into %s", (amount, unit, expected) => {
    expect(joinValue(amount, unit)).toBe(expected);
  });

  it("round-trips through splitValue", () => {
    for (const value of ["600ms", "24px", "-90deg", "50%", "1.2"]) {
      const { amount, unit } = splitValue(value);
      expect(joinValue(amount, unit)).toBe(value);
    }
  });
});
