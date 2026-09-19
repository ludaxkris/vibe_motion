import { describe, expect, it } from "vitest";

import { rowMeta } from "./row-meta";

describe("rowMeta", () => {
  it("joins trigger, duration and delay", () => {
    expect(rowMeta({ trigger: "load", duration: "600ms", delay: "0ms" })).toBe(
      "load · 600ms · 0ms",
    );
  });

  it("leaves out what is missing or empty rather than rendering an empty segment", () => {
    expect(rowMeta({ trigger: "hover" })).toBe("hover");
    expect(rowMeta({ trigger: "in-view", duration: "", delay: "60ms" })).toBe("in-view · 60ms");
  });
});
