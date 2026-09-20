import { describe, expect, it } from "vitest";

import { atLeast } from "./semver";

describe("atLeast", () => {
  it("accepts the minimum itself and anything above it", () => {
    expect(atLeast("1.1.0", "1.1.0")).toBe(true);
    expect(atLeast("1.1.1", "1.1.0")).toBe(true);
    expect(atLeast("1.2.0", "1.1.0")).toBe(true);
    expect(atLeast("2.0.0", "1.1.0")).toBe(true);
  });

  it("rejects anything below the minimum", () => {
    expect(atLeast("1.0.0", "1.1.0")).toBe(false);
    expect(atLeast("1.0.9", "1.1.0")).toBe(false);
    expect(atLeast("0.9.9", "1.1.0")).toBe(false);
  });

  it("compares each segment as a number, never as a string", () => {
    expect(atLeast("1.10.0", "1.9.0")).toBe(true);
    expect(atLeast("1.9.0", "1.10.0")).toBe(false);
    expect(atLeast("10.0.0", "9.9.9")).toBe(true);
  });

  it("is false for a missing, non-string or non-numeric version", () => {
    expect(atLeast(undefined, "1.1.0")).toBe(false);
    expect(atLeast(null, "1.1.0")).toBe(false);
    expect(atLeast(110, "1.1.0")).toBe(false);
    expect(atLeast("", "1.1.0")).toBe(false);
    expect(atLeast("1.1", "1.1.0")).toBe(false);
    expect(atLeast("1.1.0.0", "1.1.0")).toBe(false);
    expect(atLeast("1.x.0", "1.1.0")).toBe(false);
    expect(atLeast("1.1.0-beta", "1.1.0")).toBe(false);
    expect(atLeast("v1.1.0", "1.1.0")).toBe(false);
    expect(atLeast("1.-1.0", "1.1.0")).toBe(false);
  });

  it("is false when the minimum itself is malformed", () => {
    expect(atLeast("1.1.0", "one")).toBe(false);
  });
});
