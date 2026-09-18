import { describe, expect, it } from "vitest";

import type { Assignment, EditorStateMap } from "@/lib/api-client";

import { summariseDiff, type CatalogLookup } from "./diff-summary";

/**
 * A two-version lookup, so the table can prove a name resolves against the
 * version the *assignment* pinned rather than against whatever is current.
 * "Fade In Up" was renamed in the (fictional) 2.0.0 catalog.
 */
const lookup: CatalogLookup = (catalogVersion, animationId) => {
  const catalogs: Record<string, Record<string, { name: string; params: { key: string }[] }>> = {
    "1.1.0": {
      "fade-in-up": {
        name: "Fade In Up",
        params: [
          { key: "duration" },
          { key: "delay" },
          { key: "easing" },
          { key: "fillMode" },
          { key: "distance" },
        ],
      },
      pulse: {
        name: "Pulse",
        params: [
          { key: "duration" },
          { key: "delay" },
          { key: "easing" },
          { key: "iteration" },
          { key: "fillMode" },
          { key: "scale" },
        ],
      },
    },
    "2.0.0": {
      "fade-in-up": { name: "Rise", params: [{ key: "duration" }] },
    },
  };
  return catalogs[catalogVersion]?.[animationId];
};

function fadeInUp(params: Partial<Assignment["params"]> = {}): Assignment {
  return {
    animationId: "fade-in-up",
    catalogVersion: "1.1.0",
    trigger: "load",
    params: {
      duration: "600ms",
      delay: "0ms",
      easing: "ease-out",
      fillMode: "both",
      distance: "24px",
      ...params,
    },
  };
}

function pulse(params: Partial<Assignment["params"]> = {}): Assignment {
  return {
    animationId: "pulse",
    catalogVersion: "1.1.0",
    trigger: "load",
    params: {
      duration: "1200ms",
      delay: "0ms",
      easing: "ease-in-out",
      iteration: "infinite",
      fillMode: "none",
      scale: "1.05",
      ...params,
    },
  };
}

const NOTHING: EditorStateMap = {};

describe("summariseDiff", () => {
  it("reports nothing for an unchanged draft", () => {
    const state: EditorStateMap = { "vm-3": fadeInUp() };

    expect(summariseDiff(state, { ...state, "vm-3": fadeInUp() }, lookup)).toEqual({
      rows: [],
      label: "",
    });
  });

  it("reports an added assignment with its notable params", () => {
    const summary = summariseDiff(NOTHING, { "vm-3": fadeInUp() }, lookup);

    expect(summary.rows).toEqual([
      {
        kind: "added",
        sign: "+",
        vmId: "vm-3",
        name: "Fade In Up",
        // The handoff's meta, verbatim: duration · easing · the knob that is
        // this animation's own. Zero delay and `fillMode` say nothing.
        meta: "600ms · ease-out · 24px",
      },
    ]);
  });

  it("keeps a non-default delay and renders an infinite repeat as ∞", () => {
    const summary = summariseDiff(NOTHING, { "vm-9": pulse({ delay: "200ms" }) }, lookup);

    expect(summary.rows[0].meta).toBe("1200ms · 200ms · ease-in-out · ∞ · 1.05");
  });

  it("lists only what changed on a changed assignment", () => {
    const summary = summariseDiff(
      { "vm-3": fadeInUp() },
      { "vm-3": fadeInUp({ duration: "800ms" }) },
      lookup,
    );

    expect(summary.rows).toEqual([
      { kind: "changed", sign: "~", vmId: "vm-3", name: "Fade In Up", meta: "duration 600ms → 800ms" },
    ]);
  });

  it("names a changed trigger the way the handoff does", () => {
    const summary = summariseDiff(
      { "vm-3": fadeInUp() },
      { "vm-3": { ...fadeInUp(), trigger: "hover" } },
      lookup,
    );

    expect(summary.rows[0].meta).toBe("trigger load → hover");
  });

  it("describes a swapped animation by what it now is, not by a cross-entry param diff", () => {
    // `distance` and `scale` belong to different animations; diffing them
    // against each other would read as a row of appearing and vanishing knobs.
    const summary = summariseDiff({ "vm-3": fadeInUp() }, { "vm-3": pulse() }, lookup);

    expect(summary.rows[0]).toMatchObject({ kind: "changed", name: "Pulse" });
    expect(summary.rows[0].meta).toBe(
      "animation Fade In Up → Pulse · 1200ms · ease-in-out · ∞ · 1.05",
    );
  });

  it("still names a trigger and a catalog repin alongside the swap", () => {
    const summary = summariseDiff(
      { "vm-3": fadeInUp() },
      { "vm-3": { ...pulse(), catalogVersion: "2.0.0", trigger: "hover" } },
      lookup,
    );

    // 2.0.0 has no `pulse`, so the row falls back to the id it pinned.
    expect(summary.rows[0].meta).toBe(
      "animation Fade In Up → pulse · catalog 1.1.0 → 2.0.0 · trigger load → hover · 1200ms · ease-in-out · ∞ · 1.05",
    );
  });

  it("says a param is not set rather than drawing a glyph the handoff does not allow", () => {
    const withoutDistance = fadeInUp();
    delete withoutDistance.params.distance;

    expect(
      summariseDiff({ "vm-3": withoutDistance }, { "vm-3": fadeInUp() }, lookup).rows[0].meta,
    ).toBe("distance not set → 24px");
    expect(
      summariseDiff({ "vm-3": fadeInUp() }, { "vm-3": withoutDistance }, lookup).rows[0].meta,
    ).toBe("distance 24px → not set");
  });

  it("reports a removed assignment by the name its own catalog version gave it", () => {
    const summary = summariseDiff(
      { "vm-9": { ...fadeInUp(), catalogVersion: "2.0.0" } },
      NOTHING,
      lookup,
    );

    expect(summary.rows).toEqual([
      { kind: "removed", sign: "−", vmId: "vm-9", name: "Rise", meta: "" },
    ]);
  });

  it("falls back to the animation id when the pinned version has no such entry", () => {
    const summary = summariseDiff(
      NOTHING,
      { "vm-3": { ...fadeInUp(), catalogVersion: "9.9.9" } },
      lookup,
    );

    expect(summary.rows[0].name).toBe("fade-in-up");
  });

  it("orders sets before removals, each in its own map's order", () => {
    const summary = summariseDiff(
      { "vm-9": pulse(), "vm-1": fadeInUp() },
      { "vm-3": fadeInUp(), "vm-1": fadeInUp({ duration: "800ms" }) },
      lookup,
    );

    expect(summary.rows.map((row) => [row.sign, row.vmId])).toEqual([
      ["+", "vm-3"],
      ["~", "vm-1"],
      ["−", "vm-9"],
    ]);
  });

  it("writes the Save dialog's label prefill", () => {
    const summary = summariseDiff(
      { "vm-9": pulse() },
      { "vm-3": fadeInUp() },
      lookup,
    );

    expect(summary.label).toBe("Fade In Up on vm-3, removed Pulse on vm-9");
  });
});
