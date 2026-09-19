import { describe, expect, it, afterEach } from "vitest";

import { FIXTURE, destroyAll, loadBridge, page } from "./harness";
import type { ElementInfo } from "../src/protocol";

afterEach(destroyAll);

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
    // The crosshair is a rule keyed on an attribute, never an inline style on <html>: inline
    // would clobber a host cursor with no way back, and an inherited value loses to the UA's
    // `cursor: pointer` on exactly the links and buttons the designer clicks most.
    expect(h.document.documentElement.getAttribute("data-vm-mode")).toBe("edit");
    expect(h.document.documentElement.style.cursor).toBe("");
    expect(h.runtimeCss()).toContain("cursor: crosshair !important");
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

describe("the ring and a running animation", () => {
  const RESTING = { x: 10, y: 40, width: 200, height: 30 };
  const MID_FLIGHT = { x: 10, y: 64, width: 200, height: 30 };
  const KEYFRAMES = "vm-fade-in-up-v1-1-0";
  /**
   * What `layoutBox()` sees for the same element at rest — deliberately *not* equal to `RESTING`.
   * The two genuinely disagree in a browser: `offsetWidth` is rounded, an *ancestor's* transform
   * never reaches `offsetLeft`, and a wrapped inline reports its first fragment. The ring caches
   * the difference (here `+2, -1, +1, 0`) while the element is at rest and re-applies it while the
   * animation runs, so every expectation below is in `getBoundingClientRect()` terms. Drop the
   * correction and they all move.
   */
  const LAYOUT = { left: 8, top: 41, width: 199, height: 30 };

  function ring(h: ReturnType<typeof loadBridge>): HTMLElement {
    const box = h.overlay()?.querySelector<HTMLElement>("[data-vm-overlay-ring]");
    if (!box) throw new Error("no selection ring");
    return box;
  }

  function applyOurs(h: ReturnType<typeof loadBridge>, vmId: string) {
    h.send({
      type: "apply",
      payload: {
        vmId,
        trigger: "load",
        keyframesName: KEYFRAMES,
        keyframesCss: `@keyframes ${KEYFRAMES} { from { opacity: 0 } to { opacity: 1 } }`,
        style: { "animation-duration": "600ms" },
        baseStyles: "",
        animationId: "fade-in-up",
        catalogVersion: "1.1.0",
        params: {},
      },
    });
  }

  function selectedAndAnimating(h: ReturnType<typeof loadBridge>) {
    h.setRect("vm-heading", RESTING);
    applyOurs(h, "vm-heading");
    h.send({ type: "select", payload: { vmId: "vm-heading", label: "h1" } });
    return ring(h);
  }

  function boxOf(el: HTMLElement) {
    return { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
  }

  it("keeps the ring on the resting box while our animation is running", () => {
    const h = loadBridge(selectionPage);
    const box = selectedAndAnimating(h);
    expect(box.style.top).toBe("40px");

    // Mid-flight the element is translated by the animation's own distance;
    // measuring then would put the ring 24px low until `animationend`, which
    // with a replay on every slider release is most of the time.
    h.setLiveAnimations("vm-heading", [KEYFRAMES], "running");
    h.setRect("vm-heading", MID_FLIGHT);
    h.send({ type: "replay", payload: { vmId: "vm-heading" } });
    h.flushRaf();

    expect(box.style.top).toBe("40px");
  });

  it("re-measures once the animation has finished", () => {
    const h = loadBridge(selectionPage);
    const box = selectedAndAnimating(h);
    h.setLiveAnimations("vm-heading", [KEYFRAMES], "running");
    h.setRect("vm-heading", MID_FLIGHT);
    h.send({ type: "replay", payload: { vmId: "vm-heading" } });
    h.flushRaf();

    // The element settles somewhere new — a base style, a font landing — and
    // the ring has to follow it.
    h.setLiveAnimations("vm-heading", [KEYFRAMES], "finished");
    h.setRect("vm-heading", { ...RESTING, y: 52 });
    h.animationEvent("vm-heading", { animationName: KEYFRAMES });
    h.flushRaf();

    expect(box.style.top).toBe("52px");
  });

  it("re-derives the box on a capture-phase scroll while our animation is still running", () => {
    const h = loadBridge(selectionPage);
    h.setOffsetBox("vm-heading", LAYOUT);
    const box = selectedAndAnimating(h);
    expect(boxOf(box)).toEqual({ left: "10px", top: "40px", width: "200px", height: "30px" });

    // Six catalog 1.1.0 entries default to `iteration: infinite` and never fire `animationend`.
    // A ring that deferred its re-measure until the animation was over would therefore be stuck
    // at a stale `position: fixed` box for as long as the element stayed selected. The element is
    // still mid-flight here — only the page has moved under it.
    h.setLiveAnimations("vm-heading", [KEYFRAMES], "running");
    h.setRect("vm-heading", { ...MID_FLIGHT, y: MID_FLIGHT.y - 120 });
    h.setOffsetBox("vm-heading", { ...LAYOUT, top: LAYOUT.top - 120 });
    h.document.dispatchEvent(new h.window.Event("scroll", { bubbles: false }));
    h.flushRaf();

    // The resting box, moved by the scroll and by nothing else — not `MID_FLIGHT - 120`.
    expect(boxOf(box)).toEqual({ left: "10px", top: "-80px", width: "200px", height: "30px" });
  });

  it("gives an element selected while it is already animating its resting box", () => {
    const h = loadBridge(selectionPage);
    selectedAndAnimating(h);

    // vm-button carries an assignment of ours and is already mid-flight when the ring arrives, so
    // there is no at-rest measurement to correct with. None is needed: the layout box *is* the
    // resting box. Waiting for `animationend` to put it right would never have ended for one of
    // the six infinite entries.
    applyOurs(h, "vm-button");
    h.setLiveAnimations("vm-button", [KEYFRAMES], "running");
    h.setRect("vm-button", MID_FLIGHT);
    h.setOffsetBox("vm-button", { left: 10, top: 40, width: 200, height: 30 });

    h.send({ type: "select", payload: { vmId: "vm-button", label: "button" } });

    expect(boxOf(ring(h))).toEqual({ left: "10px", top: "40px", width: "200px", height: "30px" });
  });

  it("never carries one element's resting correction over to the next", () => {
    const h = loadBridge(selectionPage);
    h.setOffsetBox("vm-heading", LAYOUT);
    selectedAndAnimating(h);

    applyOurs(h, "vm-button");
    h.setLiveAnimations("vm-button", [KEYFRAMES], "running");
    h.setRect("vm-button", MID_FLIGHT);
    h.setOffsetBox("vm-button", { left: 70, top: 90, width: 120, height: 24 });
    h.send({ type: "select", payload: { vmId: "vm-button", label: "button" } });

    // vm-heading's `+2, -1, +1, 0` says nothing about vm-button: its layout box is used as it is.
    expect(boxOf(ring(h))).toEqual({ left: "70px", top: "90px", width: "120px", height: "24px" });
  });

  it("still follows an element animated by the host page", () => {
    const h = loadBridge(selectionPage);
    const box = selectedAndAnimating(h);

    // Not our keyframes: a host spinner must not freeze our ring.
    h.setLiveAnimations("vm-heading", ["spin"], "running");
    h.setRect("vm-heading", MID_FLIGHT);
    h.send({ type: "replay", payload: { vmId: "vm-heading" } });
    h.flushRaf();

    expect(box.style.top).toBe("64px");
  });
});
