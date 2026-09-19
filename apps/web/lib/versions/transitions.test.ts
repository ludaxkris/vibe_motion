import { describe, expect, it } from "vitest";
import type { Assignment, Version } from "@/lib/api-client";
import { enterViewing, exitViewing, initialVersionSlice, isDirty, loadVersion, markSaved, rebaseDraft } from "./transitions";

const a = (duration: string): Assignment => ({ animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: { duration } });
const version = (id: string): Version => ({ id, projectId: "p", parentVersionId: null, seq: 1, label: "", catalogVersion: "1.1.0", diff: { set: {}, remove: [] }, createdAt: "2026-09-18T00:00:00Z" });

describe("version transitions", () => {
  const clean = loadVersion(initialVersionSlice, "v1", { h1: a("600ms") });

  it("loadVersion lands in editing with draft == current", () => {
    expect(clean).toEqual({ draftState: { h1: a("600ms") }, currentVersionState: { h1: a("600ms") }, mode: "editing", currentVersionId: "v1", viewingVersionId: null });
  });
  it("markSaved promotes the draft", () => {
    const dirty = { ...clean, draftState: { h1: a("800ms") } };
    expect(markSaved(dirty, version("v2"))).toMatchObject({ currentVersionState: { h1: a("800ms") }, currentVersionId: "v2" });
  });
  it("enterViewing shows the old state but keeps current", () => {
    const viewing = enterViewing(clean, "v0", {});
    expect(viewing).toMatchObject({ mode: "viewing", viewingVersionId: "v0", draftState: {}, currentVersionState: { h1: a("600ms") }, currentVersionId: "v1" });
  });
  it("enterViewing refuses a dirty draft", () => {
    expect(() => enterViewing({ ...clean, draftState: {} }, "v0", {})).toThrow(/unsaved/);
  });
  it("exitViewing returns to the current version's state, back in editing", () => {
    const viewing = enterViewing(clean, "v0", { h1: a("999ms") });
    expect(exitViewing(viewing)).toEqual({
      draftState: { h1: a("600ms") }, currentVersionState: { h1: a("600ms") }, mode: "editing", currentVersionId: "v1", viewingVersionId: null,
    });
  });
  it("rebaseDraft replays my change onto the newer version", () => {
    const dirty = { ...clean, draftState: { h1: a("800ms") } };
    expect(rebaseDraft(dirty, "v2", { h1: a("600ms"), cta: a("1s") })).toMatchObject({
      draftState: { h1: a("800ms"), cta: a("1s") }, currentVersionState: { h1: a("600ms"), cta: a("1s") }, currentVersionId: "v2", mode: "editing",
    });
  });

  describe("isDirty", () => {
    it("is false when the draft matches the current version", () => {
      expect(isDirty(clean)).toBe(false);
    });
    it("is true when the draft differs from the current version while editing", () => {
      const dirty = { ...clean, draftState: { h1: a("800ms") } };
      expect(isDirty(dirty)).toBe(true);
    });
    it("is false while viewing even though draftState and currentVersionState differ", () => {
      const viewing = enterViewing(clean, "v0", { h1: a("999ms") });
      expect(viewing.draftState).not.toEqual(viewing.currentVersionState);
      expect(isDirty(viewing)).toBe(false);
    });
  });

  describe("markSaved while viewing", () => {
    it("throws rather than promoting the viewed buffer to current", () => {
      const viewing = enterViewing(clean, "v0", { h1: a("999ms") });
      expect(() => markSaved(viewing, version("v2"))).toThrow(/viewing/);
    });
  });
});
