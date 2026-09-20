import { describe, expect, it } from "vitest";
import type { Assignment, Version } from "@/lib/api-client";
import { applyDiff, computeDiff, isEmptyDiff, statesBySeq } from "./diff";

const a = (animationId: string, duration = "600ms"): Assignment => ({
  animationId, catalogVersion: "1.1.0", trigger: "load", params: { duration },
});

describe("computeDiff", () => {
  it("is empty for structurally equal states", () => {
    expect(isEmptyDiff(computeDiff({ h1: a("fade-in") }, { h1: a("fade-in") }))).toBe(true);
  });
  it("sets added and changed, removes dropped", () => {
    const diff = computeDiff(
      { h1: a("fade-in"), p: a("pulse"), img: a("zoom-in") },
      { h1: a("fade-in", "800ms"), img: a("zoom-in"), cta: a("pulse") },
    );
    expect(diff).toEqual({ set: { h1: a("fade-in", "800ms"), cta: a("pulse") }, remove: ["p"] });
  });
});

describe("applyDiff", () => {
  it("round-trips: applyDiff(a, computeDiff(a, b)) equals b", () => {
    const cases: [Record<string, Assignment>, Record<string, Assignment>][] = [
      [{}, { h1: a("fade-in") }],
      [{ h1: a("fade-in") }, {}],
      [{ h1: a("fade-in"), p: a("pulse") }, { p: a("pulse", "1s"), x: a("zoom-in") }],
    ];
    for (const [from, to] of cases) expect(applyDiff(from, computeDiff(from, to))).toEqual(to);
  });
  it("applies set before remove and does not mutate its input", () => {
    const state = { h1: a("fade-in") };
    expect(applyDiff(state, { set: { h1: a("pulse") }, remove: ["h1"] })).toEqual({});
    expect(state).toEqual({ h1: a("fade-in") });
  });
  it("rebases: my diff applied onto someone else's newer state keeps both", () => {
    const mine = computeDiff({ h1: a("fade-in") }, { h1: a("fade-in", "800ms") });
    expect(applyDiff({ h1: a("fade-in"), cta: a("pulse") }, mine)).toEqual({
      h1: a("fade-in", "800ms"), cta: a("pulse"),
    });
  });
});

describe("statesBySeq", () => {
  it("folds the ascending list into one state per version", () => {
    const v = (seq: number, diff: Version["diff"]): Version => ({
      id: `v${seq}`, projectId: "p", parentVersionId: seq ? `v${seq - 1}` : null, seq,
      label: "", catalogVersion: "1.1.0", diff, createdAt: "2026-09-18T00:00:00Z",
    });
    expect(
      statesBySeq([v(0, { set: {}, remove: [] }), v(1, { set: { h1: a("fade-in") }, remove: [] }), v(2, { set: {}, remove: ["h1"] })]),
    ).toEqual([{}, { h1: a("fade-in") }, {}]);
  });
});
