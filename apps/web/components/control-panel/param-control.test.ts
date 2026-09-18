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

  it("gives easing its own control, with the fallback option list", () => {
    expect(paramControl(param("fade-in", "easing"))).toEqual({
      kind: "easing",
      options: ["linear", "ease", "ease-in", "ease-out", "ease-in-out"],
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
        { value: "infinite", label: "∞" },
      ],
    });
  });

  it("renders a four-option select param as a dense segmented", () => {
    expect(paramControl(param("fade-in", "fillMode"))).toEqual({
      kind: "segmented",
      options: [
        { value: "none", label: "none" },
        { value: "forwards", label: "forwards" },
        { value: "backwards", label: "backwards" },
        { value: "both", label: "both" },
      ],
    });
  });

  it("renders direction as a dense segmented, from the standard CSS values", () => {
    expect(paramControl(param("spin", "direction"))).toEqual({
      kind: "segmented",
      options: [
        { value: "normal", label: "normal" },
        { value: "reverse", label: "reverse" },
        { value: "alternate", label: "alternate" },
        { value: "alternate-reverse", label: "alternate-reverse" },
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
});
