import { describe, expect, it } from "vitest";

import { initialPanelState, transition, type PanelEvent, type PanelState } from "./panel-machine";

const idle: PanelState = { status: "idle" };
const selectedA: PanelState = { status: "selected", vmId: "a" };
const choosingA: PanelState = { status: "choosing", vmId: "a" };
const tuningA: PanelState = { status: "tuning", vmId: "a", animationId: "fade-in" };

const events: Record<string, PanelEvent> = {
  SELECT_A: { type: "SELECT", vmId: "a" },
  SELECT_B: { type: "SELECT", vmId: "b" },
  SELECT_A_WITH_DRAFT: { type: "SELECT", vmId: "a", draftAnimationId: "fade-in" },
  DESELECT: { type: "DESELECT" },
  CHOOSE_CUSTOM: { type: "CHOOSE_CUSTOM" },
  PICK: { type: "PICK", animationId: "scale-in" },
  BACK: { type: "BACK" },
  BACK_WITH_DRAFT: { type: "BACK", draftAnimationId: "fade-in" },
  CLEAR: { type: "CLEAR" },
  REVERT: { type: "REVERT" },
  REVERT_WITH_DRAFT: { type: "REVERT", draftAnimationId: "fade-in" },
};

describe("transition", () => {
  it("initialPanelState is idle", () => {
    expect(initialPanelState).toEqual(idle);
  });

  describe("from idle", () => {
    it("SELECT (no draft) -> selected", () => {
      expect(transition(idle, events.SELECT_A)).toEqual(selectedA);
    });
    it("SELECT (with draft) -> tuning", () => {
      expect(transition(idle, events.SELECT_A_WITH_DRAFT)).toEqual(tuningA);
    });
    it("DESELECT is a no-op", () => {
      expect(transition(idle, events.DESELECT)).toBe(idle);
    });
    it("CHOOSE_CUSTOM is a no-op", () => {
      expect(transition(idle, events.CHOOSE_CUSTOM)).toBe(idle);
    });
    it("PICK is a no-op", () => {
      expect(transition(idle, events.PICK)).toBe(idle);
    });
    it("BACK is a no-op", () => {
      expect(transition(idle, events.BACK)).toBe(idle);
    });
    it("BACK carrying a draft is still a no-op (nothing is selected)", () => {
      expect(transition(idle, events.BACK_WITH_DRAFT)).toBe(idle);
    });
    it("CLEAR is a no-op", () => {
      expect(transition(idle, events.CLEAR)).toBe(idle);
    });
    it("REVERT is a no-op", () => {
      expect(transition(idle, events.REVERT)).toBe(idle);
    });
    it("REVERT carrying a draft is still a no-op (nothing is selected)", () => {
      expect(transition(idle, events.REVERT_WITH_DRAFT)).toBe(idle);
    });
  });

  describe("from selected { vmId: a }", () => {
    it("SELECT of a different element -> selected { b }", () => {
      expect(transition(selectedA, events.SELECT_B)).toEqual({ status: "selected", vmId: "b" });
    });
    it("SELECT of the same element with no draft is a no-op (identity)", () => {
      expect(transition(selectedA, events.SELECT_A)).toBe(selectedA);
    });
    it("SELECT of the same element with a draft -> tuning", () => {
      expect(transition(selectedA, events.SELECT_A_WITH_DRAFT)).toEqual(tuningA);
    });
    it("DESELECT -> idle", () => {
      expect(transition(selectedA, events.DESELECT)).toEqual(idle);
    });
    it("CHOOSE_CUSTOM -> choosing", () => {
      expect(transition(selectedA, events.CHOOSE_CUSTOM)).toEqual(choosingA);
    });
    it("PICK is a no-op (not choosing yet)", () => {
      expect(transition(selectedA, events.PICK)).toBe(selectedA);
    });
    it("BACK is a no-op (nothing below selected)", () => {
      expect(transition(selectedA, events.BACK)).toBe(selectedA);
    });
    it("BACK carrying a draft is still a no-op (only the picker steps back)", () => {
      expect(transition(selectedA, events.BACK_WITH_DRAFT)).toBe(selectedA);
    });
    it("CLEAR is a no-op (identity — already selected, nothing to clear back from)", () => {
      expect(transition(selectedA, events.CLEAR)).toBe(selectedA);
    });
    it("REVERT with no draft left is a no-op (identity — already there)", () => {
      expect(transition(selectedA, events.REVERT)).toBe(selectedA);
    });
    it("REVERT that restores an assignment -> tuning", () => {
      expect(transition(selectedA, events.REVERT_WITH_DRAFT)).toEqual(tuningA);
    });
  });

  describe("from choosing { vmId: a }", () => {
    it("SELECT of a different element -> selected { b }", () => {
      expect(transition(choosingA, events.SELECT_B)).toEqual({ status: "selected", vmId: "b" });
    });
    it("SELECT of the same element with no draft is a no-op (identity, not a collapse to selected)", () => {
      expect(transition(choosingA, events.SELECT_A)).toBe(choosingA);
    });
    it("SELECT with a draft -> tuning", () => {
      expect(transition(choosingA, events.SELECT_A_WITH_DRAFT)).toEqual(tuningA);
    });
    it("DESELECT -> idle", () => {
      expect(transition(choosingA, events.DESELECT)).toEqual(idle);
    });
    it("CHOOSE_CUSTOM is a no-op (already choosing)", () => {
      expect(transition(choosingA, events.CHOOSE_CUSTOM)).toBe(choosingA);
    });
    it("PICK -> tuning", () => {
      expect(transition(choosingA, events.PICK)).toEqual({
        status: "tuning",
        vmId: "a",
        animationId: "scale-in",
      });
    });
    it("BACK -> selected when the element has no draft assignment", () => {
      expect(transition(choosingA, events.BACK)).toEqual(selectedA);
    });
    it("BACK -> tuning when the element already has one", () => {
      // Otherwise "Change" then "‹" strands an animated element on a panel
      // that says "No animation yet".
      expect(transition(choosingA, events.BACK_WITH_DRAFT)).toEqual(tuningA);
    });
    it("CLEAR -> selected", () => {
      expect(transition(choosingA, events.CLEAR)).toEqual(selectedA);
    });
    it("REVERT -> selected when the revert took the assignment away", () => {
      expect(transition(choosingA, events.REVERT)).toEqual(selectedA);
    });
    it("REVERT -> tuning when the saved version still has one", () => {
      expect(transition(choosingA, events.REVERT_WITH_DRAFT)).toEqual(tuningA);
    });
  });

  describe("from tuning { vmId: a, animationId: fade-in }", () => {
    it("SELECT of a different element -> selected { b }", () => {
      expect(transition(tuningA, events.SELECT_B)).toEqual({ status: "selected", vmId: "b" });
    });
    it("SELECT of the same element with no draft is a no-op (identity, not a collapse to selected)", () => {
      expect(transition(tuningA, events.SELECT_A)).toBe(tuningA);
    });
    it("SELECT of the same element with a draft -> tuning (possibly a different animation)", () => {
      const event: PanelEvent = { type: "SELECT", vmId: "a", draftAnimationId: "scale-in" };
      expect(transition(tuningA, event)).toEqual({
        status: "tuning",
        vmId: "a",
        animationId: "scale-in",
      });
    });
    it("SELECT of the element and animation already being tuned is a no-op (identity)", () => {
      // Phase 4's bridge re-reports the same selection on every message; a
      // fresh object each time would re-render every `panel` subscriber over a
      // state that did not change.
      expect(transition(tuningA, events.SELECT_A_WITH_DRAFT)).toBe(tuningA);
    });
    it("SELECT of a different element with the same draft animation -> tuning that element", () => {
      const event: PanelEvent = { type: "SELECT", vmId: "b", draftAnimationId: "fade-in" };
      expect(transition(tuningA, event)).toEqual({
        status: "tuning",
        vmId: "b",
        animationId: "fade-in",
      });
    });
    it("DESELECT -> idle", () => {
      expect(transition(tuningA, events.DESELECT)).toEqual(idle);
    });
    it("CHOOSE_CUSTOM is a no-op (already past selected)", () => {
      expect(transition(tuningA, events.CHOOSE_CUSTOM)).toBe(tuningA);
    });
    it("PICK is a no-op (not choosing)", () => {
      expect(transition(tuningA, events.PICK)).toBe(tuningA);
    });
    it("BACK -> choosing", () => {
      expect(transition(tuningA, events.BACK)).toEqual(choosingA);
    });
    it("BACK -> choosing even carrying a draft (the picker is the step back)", () => {
      expect(transition(tuningA, events.BACK_WITH_DRAFT)).toEqual(choosingA);
    });
    it("CLEAR -> selected", () => {
      expect(transition(tuningA, events.CLEAR)).toEqual(selectedA);
    });
    it("REVERT -> selected when the revert took the assignment away", () => {
      expect(transition(tuningA, events.REVERT)).toEqual(selectedA);
    });
    it("REVERT onto the same animation is a no-op (identity)", () => {
      expect(transition(tuningA, events.REVERT_WITH_DRAFT)).toBe(tuningA);
    });
    it("REVERT onto a different animation -> tuning that one", () => {
      const event: PanelEvent = { type: "REVERT", draftAnimationId: "scale-in" };
      expect(transition(tuningA, event)).toEqual({
        status: "tuning",
        vmId: "a",
        animationId: "scale-in",
      });
    });
  });

  it("BACK from choosing then BACK from selected chains: tuning -> choosing -> selected", () => {
    const afterFirstBack = transition(tuningA, events.BACK);
    expect(afterFirstBack).toEqual(choosingA);
    const afterSecondBack = transition(afterFirstBack, events.BACK);
    expect(afterSecondBack).toEqual(selectedA);
  });

  it("Change then ‹ returns to tuning the animation the element still has", () => {
    const afterChange = transition(tuningA, events.BACK);
    expect(afterChange).toEqual(choosingA);
    expect(transition(afterChange, events.BACK_WITH_DRAFT)).toEqual(tuningA);
  });
});
