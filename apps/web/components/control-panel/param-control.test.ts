import { describe, expect, it } from "vitest";

import type { CatalogParam } from "@/lib/api-client";
import { getCatalogEntries, getCatalogEntry } from "@/lib/catalog";

import { paramControl, paramLabel } from "./param-control";

/** The catalog's own param for `animationId`, so the tests never invent one. */
function param(animationId: string, key: string): CatalogParam {
  const found = getCatalogEntry(animationId)?.params.find((p) => p.key === key);
  if (!found) throw new Error(`${animationId} has no "${key}" param`);
  return found;
}

describe("paramLabel", () => {
  it("uses the catalog's own label when it has one", () => {
    expect(paramLabel(param("fade-in-up", "distance"))).toBe("Distance");
    expect(paramLabel(param("pulse", "scale"))).toBe("Peak scale");
  });

  it("titles the standard keys the catalog leaves unlabelled, as the handoff does", () => {
    expect(paramLabel(param("fade-in", "duration"))).toBe("Duration");
    expect(paramLabel(param("fade-in", "delay"))).toBe("Delay");
    expect(paramLabel(param("fade-in", "easing"))).toBe("Easing");
    expect(paramLabel(param("pulse", "iteration"))).toBe("Repeat");
    expect(paramLabel(param("fade-in", "fillMode"))).toBe("Fill mode");
    expect(paramLabel(param("spin", "direction"))).toBe("Direction");
  });

  it("falls back to the key for anything else", () => {
    expect(paramLabel({ key: "wobbliness", type: "number", default: "1" })).toBe("wobbliness");
  });
});

describe("paramControl", () => {
  it("gives length params a slider with the catalog's range, step and unit", () => {
    expect(paramControl(param("fade-in-up", "distance"))).toEqual({
      kind: "slider",
      min: 0,
      max: 200,
      step: 2,
      unit: "px",
    });
  });

  it("gives duration params a slider in ms", () => {
    expect(paramControl(param("fade-in", "duration"))).toEqual({
      kind: "slider",
      min: 100,
      max: 5000,
      step: 50,
      unit: "ms",
    });
  });

  it("gives number params a slider with the handoff's multiplier unit", () => {
    expect(paramControl(param("pulse", "scale"))).toEqual({
      kind: "slider",
      min: 1,
      max: 1.5,
      step: 0.01,
      unit: "×",
    });
  });

  it("gives angle params a slider in deg", () => {
    expect(paramControl(param("flip-in-x", "angle"))).toEqual({
      kind: "slider",
      min: -180,
      max: 180,
      step: 5,
      unit: "deg",
    });
  });

  it("falls back to a 0-100 range when the catalog declares none", () => {
    expect(paramControl({ key: "x", type: "number", default: "5" })).toEqual({
      kind: "slider",
      min: 0,
      max: 100,
      step: 1,
      unit: "×",
    });
  });

  it("gives easing its own control, with the handoff's option order", () => {
    // docs/design/README.md, "tuning": ease, ease-out, ease-in, ease-in-out,
    // linear — most-reached-for first, not alphabetical.
    expect(paramControl(param("fade-in", "easing"))).toEqual({
      kind: "easing",
      options: ["ease", "ease-out", "ease-in", "ease-in-out", "linear"],
    });
  });

  it("keeps an easing default the fallback list does not contain (scale-in's cubic-bezier)", () => {
    const control = paramControl(param("scale-in", "easing"));
    expect(control.kind).toBe("easing");
    expect(control.kind === "easing" && control.options).toContain("cubic-bezier(0.16, 1, 0.3, 1)");
  });

  it("prefers the catalog's easing options when it declares them", () => {
    expect(
      paramControl({ key: "easing", type: "easing", default: "ease", options: ["ease", "linear"] }),
    ).toEqual({ kind: "easing", options: ["ease", "linear"] });
  });

  it("renders iteration as the handoff's dense 1 / 2 / 3 / ∞ segmented", () => {
    expect(paramControl(param("pulse", "iteration"))).toEqual({
      kind: "segmented",
      options: [
        { value: "1", label: "1" },
        { value: "2", label: "2" },
        { value: "3", label: "3" },
        // ∞ is a picture; a screen reader needs the word.
        { value: "infinite", label: "∞", ariaLabel: "Infinite" },
      ],
    });
  });

  it("sends fill mode to a select — 'backwards' does not fit a quarter of the panel", () => {
    expect(paramControl(param("fade-in", "fillMode"))).toEqual({
      kind: "select",
      options: ["none", "forwards", "backwards", "both"],
    });
  });

  it("sends direction to a select too — two options would read 'alternate…'", () => {
    expect(paramControl(param("spin", "direction"))).toEqual({
      kind: "select",
      options: ["normal", "reverse", "alternate", "alternate-reverse"],
    });
  });

  it("keeps the segmented for four options that are all short enough", () => {
    expect(
      paramControl({ key: "mood", type: "select", default: "a", options: ["a", "b", "c", "d"] }),
    ).toEqual({
      kind: "segmented",
      options: [
        { value: "a", label: "a" },
        { value: "b", label: "b" },
        { value: "c", label: "c" },
        { value: "d", label: "d" },
      ],
    });
  });

  it("switches to the easing-style select above four options", () => {
    expect(
      paramControl({
        key: "mood",
        type: "select",
        default: "a",
        options: ["a", "b", "c", "d", "e"],
      }),
    ).toEqual({ kind: "select", options: ["a", "b", "c", "d", "e"] });
  });

  it("switches to the select as soon as one label is longer than eight characters", () => {
    expect(
      paramControl({ key: "mood", type: "select", default: "a", options: ["a", "regrettable"] }),
    ).toEqual({ kind: "select", options: ["a", "regrettable"] });
  });

  it("keeps the param's own default selectable even when the option list omits it", () => {
    expect(
      paramControl({ key: "mood", type: "select", default: "z", options: ["a", "b"] }),
    ).toEqual({
      kind: "segmented",
      options: [
        { value: "a", label: "a" },
        { value: "b", label: "b" },
        { value: "z", label: "z" },
      ],
    });
  });

  it("keeps the current value selectable even when neither list has it", () => {
    // Without this the control renders with nothing checked — silently
    // disagreeing with the draft it is bound to.
    expect(
      paramControl({ key: "mood", type: "select", default: "a", options: ["a", "b"] }, "c"),
    ).toEqual({
      kind: "segmented",
      options: [
        { value: "a", label: "a" },
        { value: "b", label: "b" },
        { value: "c", label: "c" },
      ],
    });
  });

  it("offers a current value the segmented has no room for, as a select", () => {
    // A saved `iteration: "5"` is not reachable from this UI but is from the
    // API. It still has to render as the value it is; the fifth option takes
    // the row past the segmented's cap, so the select row carries it.
    expect(paramControl(param("pulse", "iteration"), "5")).toEqual({
      kind: "select",
      options: ["1", "2", "3", "infinite", "5"],
    });
  });

  it("does not duplicate a current value the list already has", () => {
    expect(paramControl(param("spin", "direction"), "reverse")).toEqual({
      kind: "select",
      options: ["normal", "reverse", "alternate", "alternate-reverse"],
    });
  });

  it("keeps a tuned easing the fallback list has never heard of", () => {
    const control = paramControl(param("fade-in", "easing"), "cubic-bezier(.34,1.56,.64,1)");
    expect(control.kind === "easing" && control.options).toContain(
      "cubic-bezier(.34,1.56,.64,1)",
    );
  });

  it("gives color params a text field — catalog colours are rgba()/currentColor", () => {
    expect(paramControl(param("glow", "color"))).toEqual({ kind: "color" });
  });

  it("covers every param of every current-catalog entry", () => {
    for (const entry of getCatalogEntries()) {
      for (const p of entry.params) {
        expect(paramControl(p).kind).toBeTruthy();
        expect(paramLabel(p)).not.toBe("");
      }
    }
  });

  it("never offers a segment label that would clip in the 320px panel", () => {
    for (const entry of getCatalogEntries()) {
      for (const p of entry.params) {
        const control = paramControl(p);
        if (control.kind !== "segmented") continue;
        expect(control.options.length).toBeLessThanOrEqual(4);
        for (const option of control.options) {
          expect(option.label.length).toBeLessThanOrEqual(8);
        }
      }
    }
  });
});
