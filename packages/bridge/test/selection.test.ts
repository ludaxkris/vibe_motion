import { describe, expect, it } from "vitest";

import { FIXTURE, loadBridge, page } from "./harness";
import type { ElementInfo } from "../src/protocol";

const LONG = "Sign up for the newsletter and get a weekly digest of everything we shipped, plus the odd opinion";

const selectionPage = page(`
  <h1 data-vm-id="vm-heading">   Hello
     there,   designer   </h1>
  <button data-vm-id="vm-button" role="button"><span class="inner">Go</span></button>
  <p data-vm-id="vm-para">${LONG}</p>`);

function hovers(h: ReturnType<typeof loadBridge>): Array<ElementInfo | { vmId: null }> {
  return h.payloads("element:hover") as Array<ElementInfo | { vmId: null }>;
}

describe("overlay", () => {
  it("adds one pointer-transparent container that is not part of the page", () => {
    const h = loadBridge(FIXTURE);

    const overlay = h.overlay();
    expect(overlay).not.toBeNull();
    expect(overlay?.parentElement).toBe(h.document.body);
    expect(overlay?.style.pointerEvents).toBe("none");
    expect(overlay?.hasAttribute("data-vm-id")).toBe(false);
    expect(h.document.documentElement.style.cursor).toBe("crosshair");
  });

  it("is not counted among the page's tagged elements", () => {
    const h = loadBridge(FIXTURE);

    expect(h.payloads("ready")[0]).toMatchObject({ elementCount: 3 });
    expect(h.document.querySelectorAll("[data-vm-id]")).toHaveLength(3);
  });
});

describe("click", () => {
  it("reports the nearest tagged ancestor of whatever was clicked", () => {
    const h = loadBridge(selectionPage);

    const event = h.click(h.document.querySelector(".inner") as Node);

    expect(event.defaultPrevented).toBe(true);
    const selects = h.payloads("element:select") as ElementInfo[];
    expect(selects).toHaveLength(1);
    expect(selects[0]).toMatchObject({ vmId: "vm-button", tag: "button", role: "button", textPreview: "Go" });
  });

  it("collapses whitespace and caps the text preview at 80 characters", () => {
    const h = loadBridge(selectionPage);

    h.click(h.el("vm-heading"));
    h.click(h.el("vm-para"));

    const selects = h.payloads("element:select") as ElementInfo[];
    expect(selects[0].textPreview).toBe("Hello there, designer");
    expect(selects[1].textPreview).toHaveLength(80);
    expect(selects[1].textPreview).toBe(LONG.slice(0, 80));
  });

  it("reports document order and a null role when there is no role attribute", () => {
    const h = loadBridge(selectionPage);

    h.click(h.el("vm-para"));
    h.click(h.el("vm-heading"));

    const selects = h.payloads("element:select") as ElementInfo[];
    expect(selects[0]).toMatchObject({ vmId: "vm-para", order: 2, role: null });
    expect(selects[1]).toMatchObject({ vmId: "vm-heading", order: 0 });
  });

  it("never moves the selection ring on its own (spec D10)", () => {
    const h = loadBridge(selectionPage);
    h.send({ type: "select", payload: { vmId: "vm-heading" }, seq: 1 });
    expect(h.overlay()?.getAttribute("data-vm-selected")).toBe("vm-heading");

    h.click(h.el("vm-button"));

    expect(h.payloads("element:select")).toHaveLength(1);
    expect(h.overlay()?.getAttribute("data-vm-selected")).toBe("vm-heading");
  });

  it("asks for a deselect when the click resolves to no tagged element", () => {
    const h = loadBridge(selectionPage);

    h.click(h.document.body);

    expect(h.payloads("element:deselect")).toEqual([{ reason: "background" }]);
    expect(h.payloads("element:select")).toEqual([]);
  });
});

describe("keyboard", () => {
  it("asks for a deselect on Escape", () => {
    const h = loadBridge(selectionPage);

    h.keydown("Escape");

    expect(h.payloads("element:deselect")).toEqual([{ reason: "escape" }]);
  });

  it("ignores other keys", () => {
    const h = loadBridge(selectionPage);

    h.keydown("a");

    expect(h.payloads("element:deselect")).toEqual([]);
  });
});

describe("hover", () => {
  it("reports only when the tagged element under the pointer changes", () => {
    const h = loadBridge(selectionPage);
    const button = h.el("vm-button");
    const inner = h.document.querySelector(".inner") as Node;

    h.mouse("pointerover", button);
    h.mouse("pointerout", button, inner);
    h.mouse("pointerover", inner);
    expect(hovers(h)).toHaveLength(1);
    expect(hovers(h)[0]).toMatchObject({ vmId: "vm-button" });

    h.mouse("pointerout", inner, h.el("vm-heading"));
    h.mouse("pointerover", h.el("vm-heading"));
    expect(hovers(h)).toHaveLength(2);
    expect(hovers(h)[1]).toMatchObject({ vmId: "vm-heading" });

    h.mouse("pointerout", h.el("vm-heading"), h.document.body);
    expect(hovers(h)).toHaveLength(3);
    expect(hovers(h)[2]).toEqual({ vmId: null });
  });

  it("marks the hovered element on the overlay and clears it on leave", () => {
    const h = loadBridge(selectionPage);

    h.mouse("pointerover", h.el("vm-heading"));
    expect(h.overlay()?.getAttribute("data-vm-hovered")).toBe("vm-heading");

    h.mouse("pointerout", h.el("vm-heading"), null);
    expect(h.overlay()?.hasAttribute("data-vm-hovered")).toBe(false);
  });
});

describe("select", () => {
  it("draws the ring with the label the shell supplied", () => {
    const h = loadBridge(selectionPage);

    h.send({ type: "select", payload: { vmId: "vm-heading", label: "h1 · Fade In Up" }, seq: 1 });

    const overlay = h.overlay();
    expect(overlay?.getAttribute("data-vm-selected")).toBe("vm-heading");
    expect(overlay?.textContent).toContain("h1 · Fade In Up");
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: true });
  });

  it("falls back to the element's tag as the label", () => {
    const h = loadBridge(selectionPage);

    h.send({ type: "select", payload: { vmId: "vm-button" }, seq: 1 });

    expect(h.overlay()?.textContent).toContain("button");
  });

  it("removes the ring on select null", () => {
    const h = loadBridge(selectionPage);
    h.send({ type: "select", payload: { vmId: "vm-heading" }, seq: 1 });

    h.send({ type: "select", payload: { vmId: null }, seq: 2 });

    expect(h.overlay()?.hasAttribute("data-vm-selected")).toBe(false);
    expect(h.lastAck()).toMatchObject({ seq: 2, ok: true });
  });

  it("rejects a selection of an element the page does not have", () => {
    const h = loadBridge(selectionPage);

    h.send({ type: "select", payload: { vmId: "vm-nope" }, seq: 1 });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "unknown-element" });
    expect(h.overlay()?.hasAttribute("data-vm-selected")).toBe(false);
  });

  it("scrolls the element into view only when asked", () => {
    const h = loadBridge(selectionPage);
    const calls: unknown[] = [];
    // jsdom does not implement scrollIntoView, so the bridge has to feature-detect it.
    (h.el("vm-para") as unknown as { scrollIntoView: (o: unknown) => void }).scrollIntoView = (o) => {
      calls.push(o);
    };

    h.send({ type: "select", payload: { vmId: "vm-para" }, seq: 1 });
    expect(calls).toHaveLength(0);

    h.send({ type: "select", payload: { vmId: "vm-para", scrollIntoView: true }, seq: 2 });
    expect(calls).toHaveLength(1);
  });
});

describe("overlay repositioning", () => {
  it("re-measures in a frame after a capture-phase scroll, not synchronously", () => {
    const h = loadBridge(selectionPage);
    h.send({ type: "select", payload: { vmId: "vm-heading" }, seq: 1 });

    let measured = 0;
    const el = h.el("vm-heading");
    const originalRect = el.getBoundingClientRect.bind(el);
    el.getBoundingClientRect = () => {
      measured += 1;
      return originalRect();
    };

    h.document.dispatchEvent(new h.window.Event("scroll", { bubbles: false }));
    h.document.dispatchEvent(new h.window.Event("scroll", { bubbles: false }));
    expect(measured).toBe(0);

    h.flushRaf();
    expect(measured).toBe(1);
  });
});
