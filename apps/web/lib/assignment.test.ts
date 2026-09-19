import { describe, expect, it } from "vitest";

import type { Assignment } from "@/lib/api-client";
import { assignmentsEqual } from "@/lib/assignment";

function fadeInUp(overrides: Partial<Assignment> = {}): Assignment {
  return {
    animationId: "fade-in-up",
    catalogVersion: "1.1.0",
    trigger: "load",
    params: { duration: "600ms", distance: "24px" },
    ...overrides,
  };
}

describe("assignmentsEqual", () => {
  it("is true for two separately built assignments with the same content", () => {
    expect(assignmentsEqual(fadeInUp(), fadeInUp())).toBe(true);
  });

  it("is true for the same object", () => {
    const assignment = fadeInUp();
    expect(assignmentsEqual(assignment, assignment)).toBe(true);
  });

  it("is true when both are absent, false when only one is", () => {
    expect(assignmentsEqual(undefined, undefined)).toBe(true);
    expect(assignmentsEqual(fadeInUp(), undefined)).toBe(false);
    expect(assignmentsEqual(undefined, fadeInUp())).toBe(false);
  });

  it("is false for a different animation, pin or trigger", () => {
    expect(assignmentsEqual(fadeInUp(), fadeInUp({ animationId: "pulse" }))).toBe(false);
    expect(assignmentsEqual(fadeInUp(), fadeInUp({ catalogVersion: "1.0.0" }))).toBe(false);
    expect(assignmentsEqual(fadeInUp(), fadeInUp({ trigger: "hover" }))).toBe(false);
  });

  it("is false for a param whose value moved", () => {
    expect(
      assignmentsEqual(fadeInUp(), fadeInUp({ params: { duration: "800ms", distance: "24px" } })),
    ).toBe(false);
  });

  it("is false when one side carries a param the other does not", () => {
    expect(assignmentsEqual(fadeInUp(), fadeInUp({ params: { duration: "600ms" } }))).toBe(false);
    expect(
      assignmentsEqual(
        fadeInUp({ params: { duration: "600ms" } }),
        fadeInUp({ params: { delay: "600ms" } }),
      ),
    ).toBe(false);
  });
});
