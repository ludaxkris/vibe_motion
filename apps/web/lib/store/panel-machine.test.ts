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
  CLEAR: { type: "CLEAR" },
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
    it("CLEAR is a no-op", () => {
      expect(transition(idle, events.CLEAR)).toBe(idle);
    });
  });

  describe("from selected { vmId: a }", () => {
    it("SELECT of a different element -> selected { b }", () => {
      expect(transition(selectedA, events.SELECT_B)).toEqual({ status: "selected", vmId: "b" });
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
    it("CLEAR -> selected (idempotent)", () => {
      expect(transition(selectedA, events.CLEAR)).toEqual(selectedA);
    });
  });

  describe("from choosing { vmId: a }", () => {
    it("SELECT of a different element -> selected { b }", () => {
      expect(transition(choosingA, events.SELECT_B)).toEqual({ status: "selected", vmId: "b" });
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
    it("BACK -> selected", () => {
      expect(transition(choosingA, events.BACK)).toEqual(selectedA);
    });
    it("CLEAR -> selected", () => {
      expect(transition(choosingA, events.CLEAR)).toEqual(selectedA);
    });
  });

  describe("from tuning { vmId: a, animationId: fade-in }", () => {
    it("SELECT of a different element -> selected { b }", () => {
      expect(transition(tuningA, events.SELECT_B)).toEqual({ status: "selected", vmId: "b" });
    });
    it("SELECT of the same element with a draft -> tuning (possibly a different animation)", () => {
      const event: PanelEvent = { type: "SELECT", vmId: "a", draftAnimationId: "scale-in" };
      expect(transition(tuningA, event)).toEqual({
        status: "tuning",
        vmId: "a",
        animationId: "scale-in",
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
    it("CLEAR -> selected", () => {
      expect(transition(tuningA, events.CLEAR)).toEqual(selectedA);
    });
  });

  it("BACK from choosing then BACK from selected chains: tuning -> choosing -> selected", () => {
    const afterFirstBack = transition(tuningA, events.BACK);
    expect(afterFirstBack).toEqual(choosingA);
    const afterSecondBack = transition(afterFirstBack, events.BACK);
    expect(afterSecondBack).toEqual(selectedA);
  });
});
