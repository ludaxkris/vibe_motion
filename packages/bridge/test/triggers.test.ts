import { describe, expect, it, vi, afterEach } from "vitest";

import { FIXTURE, applied, destroyAll, loadBridge, page } from "./harness";
import { IN_VIEW_THRESHOLD } from "../src/protocol";

afterEach(destroyAll);

const hostPage = page(`
  <h1 data-vm-id="vm-heading" style="animation-duration: 9s">Heading</h1>
  <button data-vm-id="vm-button"><span class="inner">Go</span></button>
  <p data-vm-id="vm-para">Body</p>`);

const held = {
  trigger: "in-view" as const,
  style: {
    "animation-duration": "600ms",
    "animation-delay": "300ms",
    "animation-fill-mode": "forwards",
    "--vm-distance": "24px",
  },
};

describe("hover trigger", () => {
  it("arms on pointer enter and disarms on pointer leave", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });
    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-name")).toBe("");

    h.mouse("pointerover", el);
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");

    h.mouse("pointerout", el, null);
    expect(el.style.getPropertyValue("animation-name")).toBe("");
  });

  it("arms from a pointer event on an untagged descendant", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ vmId: "vm-button", trigger: "hover" }), seq: 1 });

    h.mouse("pointerover", h.document.querySelector(".inner") as Node);

    expect(h.el("vm-button").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("leaves the host page's own inline animation properties alone while unarmed", () => {
    const h = loadBridge(hostPage);

    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });

    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-duration")).toBe("9s");
    expect(el.style.getPropertyValue("animation-name")).toBe("");
    expect(el.style.getPropertyValue("--vm-distance")).toBe("24px");
  });

  it("keeps a hover-armed ancestor armed while the pointer is over a tagged descendant (B3)", () => {
    const nested = page(`
      <div data-vm-id="vm-card"><button data-vm-id="vm-btn"><span class="label">press</span></button></div>`);
    const h = loadBridge(nested);
    h.send({ type: "apply", payload: applied({ vmId: "vm-card", trigger: "hover" }), seq: 1 });
    h.send({ type: "apply", payload: applied({ vmId: "vm-btn", trigger: "hover" }), seq: 2 });

    h.mouse("pointerover", h.el("vm-card"));
    expect(h.el("vm-card").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");

    // Onto the tagged button: the card is still hovered as far as the page is concerned, and a
    // CSS `:hover` rule would still match it. The export must agree with the preview.
    h.mouse("pointerout", h.el("vm-card"), h.document.querySelector(".label") as Node);
    h.mouse("pointerover", h.document.querySelector(".label") as Node);

    expect(h.el("vm-card").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(h.el("vm-btn").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    // The outline and the message stay nearest-only.
    expect((h.payloads("element:hover") as Array<{ vmId: string | null }>).map((p) => p.vmId)).toEqual([
      "vm-card",
      "vm-btn",
    ]);
    expect(h.overlay()?.getAttribute("data-vm-hovered")).toBe("vm-btn");

    h.mouse("pointerout", h.el("vm-btn"), null);
    expect(h.el("vm-card").style.getPropertyValue("animation-name")).toBe("");
    expect(h.el("vm-btn").style.getPropertyValue("animation-name")).toBe("");
  });

  it("arms an ancestor that gains a hover assignment while already hovered", () => {
    const nested = page(`<div data-vm-id="vm-card"><button data-vm-id="vm-btn">press</button></div>`);
    const h = loadBridge(nested);
    h.mouse("pointerover", h.el("vm-btn"));

    h.send({ type: "apply", payload: applied({ vmId: "vm-card", trigger: "hover" }), seq: 1 });

    expect(h.el("vm-card").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("writes only custom properties for a param-only change while unarmed", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });

    h.send({
      type: "apply",
      payload: applied({ trigger: "hover", style: { "animation-duration": "1200ms", "--vm-distance": "40px" } }),
      seq: 2,
    });

    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("--vm-distance")).toBe("40px");
    expect(el.style.getPropertyValue("animation-duration")).toBe("9s");
    expect(el.style.getPropertyValue("animation-name")).toBe("");
  });
});

/**
 * Record every `animation-name` the bridge writes on an element, in order. Toggling
 * play-state / delay / fill-mode updates an animation in place; only an `animation-name` change
 * gives the element a *new* animation, which is the whole of B1.
 */
function watchNameWrites(h: ReturnType<typeof loadBridge>, vmId: string): string[] {
  const el = h.el(vmId);
  const writes: string[] = [];
  const write = el.style.setProperty.bind(el.style);
  vi.spyOn(el.style, "setProperty").mockImplementation((prop: string, value: string | null, priority?: string) => {
    if (prop === "animation-name") writes.push(value ?? "");
    write(prop, value, priority);
  });
  return writes;
}

describe("in-view trigger", () => {
  it("arms on entry, disarms on exit and re-arms on the next entry", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "in-view" }), seq: 1 });
    const el = h.el("vm-heading");

    h.intersect("vm-heading", true);
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");

    h.intersect("vm-heading", false);
    expect(el.style.getPropertyValue("animation-play-state")).toBe("paused");

    h.intersect("vm-heading", true);
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");
  });

  it("gives the element a new animation on every arm-state transition (spec D3)", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "in-view" }), seq: 1 });
    const writes = watchNameWrites(h, "vm-heading");

    h.intersect("vm-heading", true);
    expect(writes).toEqual(["none", "vm-fade-in-up-v1-1-0"]);

    writes.length = 0;
    h.intersect("vm-heading", false);
    expect(writes).toEqual(["none", "vm-fade-in-up-v1-1-0"]);

    writes.length = 0;
    h.intersect("vm-heading", true);
    expect(writes).toEqual(["none", "vm-fade-in-up-v1-1-0"]);
  });

  it("rewinds one batch of transitions with a single style flush", () => {
    const body = Array.from({ length: 3 }, (_, i) => `<div data-vm-id="vm-box-${i}">box ${i}</div>`).join("");
    const h = loadBridge(page(body));
    for (let i = 0; i < 3; i += 1) {
      h.send({ type: "apply", payload: applied({ vmId: `vm-box-${i}`, trigger: "in-view" }), seq: i + 1 });
    }
    let flushes = 0;
    const real = h.window.getComputedStyle.bind(h.window);
    vi.spyOn(h.window, "getComputedStyle").mockImplementation(((el: Element) => {
      flushes += 1;
      return real(el);
    }) as typeof h.window.getComputedStyle);

    h.observers()[0].fire([
      { vmId: "vm-box-0", isIntersecting: true },
      { vmId: "vm-box-1", isIntersecting: true },
      { vmId: "vm-box-2", isIntersecting: true },
    ]);

    expect(flushes).toBe(1);
    for (let i = 0; i < 3; i += 1) {
      expect(h.el(`vm-box-${i}`).style.getPropertyValue("animation-play-state")).toBe("running");
    }
  });

  it("holds a forced replay's element back at its first keyframe when it ends off-screen", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(held), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });
    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");
    const writes = watchNameWrites(h, "vm-heading");

    h.animationEvent("vm-heading");

    expect(writes).toEqual(["none", "vm-fade-in-up-v1-1-0"]);
    expect(el.style.getPropertyValue("animation-play-state")).toBe("paused");
    expect(el.style.getPropertyValue("animation-delay")).toBe("0s");
    expect(el.style.getPropertyValue("animation-fill-mode")).toBe("both");
  });

  it("holds the element on its first keyframe until the trigger fires (spec D3)", () => {
    const h = loadBridge(hostPage);

    h.send({ type: "apply", payload: applied(held), seq: 1 });

    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("paused");
    expect(el.style.getPropertyValue("animation-delay")).toBe("0s");
    expect(el.style.getPropertyValue("animation-fill-mode")).toBe("both");
    expect(el.style.getPropertyPriority("animation-play-state")).toBe("important");
    expect(el.style.getPropertyPriority("animation-delay")).toBe("important");
    expect(el.style.getPropertyPriority("animation-fill-mode")).toBe("important");

    h.intersect("vm-heading", true);

    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");
    expect(el.style.getPropertyValue("animation-delay")).toBe("300ms");
    expect(el.style.getPropertyValue("animation-fill-mode")).toBe("forwards");
  });

  it("restores the host page's inline values when a held element is cleared", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(held), seq: 1 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("600ms");

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 2 });

    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-duration")).toBe("9s");
    expect(el.style.getPropertyValue("animation-name")).toBe("");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("");
    expect(el.style.getPropertyValue("--vm-distance")).toBe("");
  });

  it("shares one IntersectionObserver across every in-view assignment", () => {
    const body = Array.from({ length: 5 }, (_, i) => `<div data-vm-id="vm-box-${i}">box ${i}</div>`).join("");
    const h = loadBridge(page(body));

    for (let i = 0; i < 5; i += 1) {
      h.send({ type: "apply", payload: applied({ vmId: `vm-box-${i}`, trigger: "in-view" }), seq: i + 1 });
    }

    expect(h.observers()).toHaveLength(1);
    expect(h.observers()[0].targets.size).toBe(5);
    // Two thresholds: 0, so an element that can never reach the real one is still reported the
    // moment it intersects at all, and the real one for everything else (spec §6a).
    expect(h.observers()[0].options?.threshold).toEqual([0, IN_VIEW_THRESHOLD]);
  });

  it("stops observing an element whose assignment is cleared", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "in-view" }), seq: 1 });
    expect(h.observers()[0].targets.size).toBe(1);

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 2 });

    expect(h.observers()[0].targets.size).toBe(0);
  });
});

/**
 * The firing condition itself (A12 / DT-095 / DT-179), the same one the export runtime uses
 * (`src/vibe-motion-export.js`, spec §6a): `isIntersecting && (ratio >= T || reachable <= T)`,
 * where `reachable = min(1, rootW/w) * min(1, rootH/h)` is the largest ratio the element could
 * ever attain. `intersectionRatio` is an **area** ratio, so an element big enough can never reach
 * `T` at all and a ratio-only rule holds it on its first keyframe for ever.
 *
 * jsdom has no layout and no `IntersectionObserver`, so each case states its own entry. What only
 * `e2e/bridge.spec.ts` can prove is that a real observer reports these entries for a real element:
 * these tests are the arithmetic, that one is the behaviour.
 */
describe("in-view reachability", () => {
  const playState = (h: ReturnType<typeof loadBridge>, vmId: string) =>
    h.el(vmId).style.getPropertyValue("animation-play-state");

  /** An in-view assignment, held on its first keyframe until the trigger fires. */
  function applyInView(h: ReturnType<typeof loadBridge>, vmId: string, seq: number) {
    h.send({ type: "apply", payload: applied({ ...held, vmId }), seq });
    expect(playState(h, vmId)).toBe("paused");
  }

  it("fires for an element taller than the root can ever show, well under the threshold", () => {
    const h = loadBridge(hostPage);
    applyInView(h, "vm-heading", 1);

    // Six viewports tall: it can show at most 1/6 = 0.167 of itself, so `ratio >= 0.2` is not a
    // condition it can ever meet, in the preview or in the export.
    h.intersect("vm-heading", {
      intersectionRatio: 0.16,
      boundingClientRect: { width: 200, height: h.window.innerHeight * 6 },
    });

    expect(playState(h, "vm-heading")).toBe("running");
  });

  it("fires for a track wider than the root, at a perfectly ordinary height", () => {
    const h = loadBridge(hostPage);
    applyInView(h, "vm-heading", 1);

    // Reachability is an area, not a height: a wide track in a horizontal scroller is short of the
    // threshold on the width axis alone.
    h.intersect("vm-heading", {
      intersectionRatio: 0.1,
      boundingClientRect: { width: h.window.innerWidth * 6, height: 60 },
    });

    expect(playState(h, "vm-heading")).toBe("running");
  });

  it("measures against rootBounds when the observer reports one, and the window when it is null", () => {
    const h = loadBridge(hostPage);
    applyInView(h, "vm-heading", 1);
    applyInView(h, "vm-para", 2);
    const box = { width: 4000, height: 60 };

    // Against a 640px-wide root, 640/4000 = 0.16: unreachable, so it fires.
    h.intersect("vm-heading", { intersectionRatio: 0.1, boundingClientRect: box, rootBounds: { width: 640, height: 400 } });
    // Against this window (jsdom's 1024), 1024/4000 = 0.256: reachable, so the ratio still rules.
    // `rootBounds` is null for an implicit root inside a cross-origin iframe — which is every
    // bridge there is — so this fallback is the bridge's normal path, not its edge case.
    h.intersect("vm-para", { intersectionRatio: 0.1, boundingClientRect: box, rootBounds: null });

    expect(h.window.innerWidth).toBeGreaterThan(640);
    expect(playState(h, "vm-heading")).toBe("running");
    expect(playState(h, "vm-para")).toBe("paused");
  });

  it("still waits for the real threshold when the element can reach it", () => {
    const h = loadBridge(hostPage);
    applyInView(h, "vm-heading", 1);
    const box = { width: 200, height: 60 };

    // On screen, but by a sliver: a box this size can reach ratio 1, so the escape hatch is not
    // for it. Intersecting at all is what the `0` threshold reports; it is not "in view".
    h.intersect("vm-heading", { intersectionRatio: 0.1, boundingClientRect: box });
    expect(playState(h, "vm-heading")).toBe("paused");

    h.intersect("vm-heading", { intersectionRatio: 0.25, boundingClientRect: box });
    expect(playState(h, "vm-heading")).toBe("running");
  });

  it("disarms a reachable element when its ratio drops back under the threshold", () => {
    const h = loadBridge(hostPage);
    applyInView(h, "vm-heading", 1);
    const box = { width: 200, height: 60 };
    h.intersect("vm-heading", { intersectionRatio: 0.5, boundingClientRect: box });
    expect(playState(h, "vm-heading")).toBe("running");

    // Unchanged from the single-threshold bridge: for an element that can reach `T`, the arm
    // boundary is `T` in both directions, not "has left the viewport entirely".
    h.intersect("vm-heading", { intersectionRatio: 0.1, boundingClientRect: box });

    expect(playState(h, "vm-heading")).toBe("paused");
    expect(h.el("vm-heading").style.getPropertyValue("animation-delay")).toBe("0s");
    expect(h.el("vm-heading").style.getPropertyValue("animation-fill-mode")).toBe("both");
  });

  it("disarms an unreachable element only when it stops intersecting, and re-arms on the next entry", () => {
    const h = loadBridge(hostPage);
    applyInView(h, "vm-heading", 1);
    const tall = { width: 200, height: h.window.innerHeight * 6 };

    h.intersect("vm-heading", { intersectionRatio: 0.16, boundingClientRect: tall });
    expect(playState(h, "vm-heading")).toBe("running");

    // A ratio it can never raise is not a reason to hold it again: only leaving is.
    h.intersect("vm-heading", { intersectionRatio: 0.02, boundingClientRect: tall });
    expect(playState(h, "vm-heading")).toBe("running");

    h.intersect("vm-heading", { isIntersecting: false, intersectionRatio: 0, boundingClientRect: tall });
    expect(playState(h, "vm-heading")).toBe("paused");

    // Re-armed on the next entry, the preview's deliberate divergence from the export (spec §6a).
    h.intersect("vm-heading", { intersectionRatio: 0.16, boundingClientRect: tall });
    expect(playState(h, "vm-heading")).toBe("running");
  });

  it("does not treat a zero-size element, or a zero-size root, as unreachable", () => {
    const h = loadBridge(hostPage);
    applyInView(h, "vm-heading", 1);
    applyInView(h, "vm-para", 2);
    const zero = { width: 0, height: 0 };

    // A zero box never really intersects, but an element in a collapsed or hidden container can
    // still be reported. `rootSize / 0` is Infinity and `0 / 0` is NaN; neither may come out as
    // "it can never reach the threshold, so play it".
    h.intersect("vm-heading", { isIntersecting: true, intersectionRatio: 0, boundingClientRect: zero });
    h.intersect("vm-para", { isIntersecting: true, intersectionRatio: 0, boundingClientRect: zero, rootBounds: zero });

    expect(playState(h, "vm-heading")).toBe("paused");
    expect(playState(h, "vm-para")).toBe("paused");
  });
});

describe("replay", () => {
  it("sets the name to none, forces a style flush and puts it back inside the handler", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied(), seq: 1 });

    const el = h.el("vm-heading");
    const order: string[] = [];
    const write = el.style.setProperty.bind(el.style);
    vi.spyOn(el.style, "setProperty").mockImplementation((prop: string, value: string | null, priority?: string) => {
      if (prop === "animation-name") order.push(`set:${value}`);
      write(prop, value, priority);
    });
    const computed = h.window.getComputedStyle(el);
    vi.spyOn(h.window, "getComputedStyle").mockImplementation(() => {
      order.push("flush");
      return computed;
    });

    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });

    expect(order).toEqual(["set:none", "flush", "set:vm-fade-in-up-v1-1-0"]);
    expect(h.lastAck()).toMatchObject({ seq: 2, ok: true });
  });

  it("rewinds every element in one batch, with a single style flush, when vmId is null", () => {
    const body = Array.from({ length: 4 }, (_, i) => `<div data-vm-id="vm-box-${i}">box ${i}</div>`).join("");
    const h = loadBridge(page(body));
    for (let i = 0; i < 4; i += 1) {
      h.send({ type: "apply", payload: applied({ vmId: `vm-box-${i}` }), seq: i + 1 });
    }
    let flushes = 0;
    const real = h.window.getComputedStyle.bind(h.window);
    vi.spyOn(h.window, "getComputedStyle").mockImplementation(((el: Element) => {
      flushes += 1;
      return real(el);
    }) as typeof h.window.getComputedStyle);

    h.send({ type: "replay", payload: { vmId: null }, seq: 5 });

    // N elements must cost one style recalculation, not N.
    expect(flushes).toBe(1);
    for (let i = 0; i < 4; i += 1) {
      expect(h.el(`vm-box-${i}`).style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    }
  });

  it("flushes on the root, so a detached element in the batch cannot cost the others their restart", () => {
    const body = Array.from({ length: 3 }, (_, i) => `<div data-vm-id="vm-box-${i}">box ${i}</div>`).join("");
    const h = loadBridge(page(body));
    for (let i = 0; i < 3; i += 1) {
      h.send({ type: "apply", payload: applied({ vmId: `vm-box-${i}` }), seq: i + 1 });
    }
    // Anchoring the one flush on `batch[0].el` unconditionally would resolve style on a node
    // that is not in an active document, which Blink skips entirely: nothing in the batch would
    // restart. The anchor has to skip past it to something still in the document.
    const detached = h.el("vm-box-0");
    detached.parentNode?.removeChild(detached);
    const flushed: Array<Element | null> = [];
    const real = h.window.getComputedStyle.bind(h.window);
    vi.spyOn(h.window, "getComputedStyle").mockImplementation(((el: Element) => {
      flushed.push(el);
      return real(el);
    }) as typeof h.window.getComputedStyle);
    const one = watchNameWrites(h, "vm-box-1");
    const two = watchNameWrites(h, "vm-box-2");

    h.send({ type: "replay", payload: { vmId: null }, seq: 4 });

    expect(flushed).toEqual([h.el("vm-box-1")]);
    expect(one).toEqual(["none", "vm-fade-in-up-v1-1-0"]);
    expect(two).toEqual(["none", "vm-fade-in-up-v1-1-0"]);
  });

  it("replays every assigned element when vmId is null", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ vmId: "vm-heading" }), seq: 1 });
    h.send({ type: "apply", payload: applied({ vmId: "vm-button", trigger: "hover" }), seq: 2 });
    expect(h.el("vm-button").style.getPropertyValue("animation-name")).toBe("");
    const heading = watchNameWrites(h, "vm-heading");
    const button = watchNameWrites(h, "vm-button");

    h.send({ type: "replay", payload: { vmId: null }, seq: 3 });

    // The armed one restarts; the unarmed one is forced to play once.
    expect(heading).toEqual(["none", "vm-fade-in-up-v1-1-0"]);
    expect(button).toEqual(["none", "vm-fade-in-up-v1-1-0"]);
  });

  it("arms an unarmed hover element for one play and lets it go again on animationend", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });
    const el = h.el("vm-heading");

    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");

    h.animationEvent("vm-heading");

    expect(el.style.getPropertyValue("animation-name")).toBe("");
    expect(el.style.getPropertyValue("animation-duration")).toBe("9s");
  });

  it("is not ended by an animation finishing on a descendant (spec replay row)", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ vmId: "vm-button", trigger: "hover" }), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-button" }, seq: 2 });

    // What a host spinner, ripple or marquee inside the element does on any real cloned page.
    h.animationEvent("vm-button", {
      target: h.document.querySelector(".inner") as Node,
      animationName: "hostspin",
    });

    expect(h.el("vm-button").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("is not ended by another animation finishing on the element itself", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });

    h.animationEvent("vm-heading", { animationName: "hostspin" });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("ends an infinite forced replay on its first iteration boundary", () => {
    const h = loadBridge(hostPage);
    h.send({
      type: "apply",
      payload: applied({ trigger: "hover", style: { "animation-iteration-count": "infinite" } }),
      seq: 1,
    });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");

    h.animationEvent("vm-heading", { type: "animationiteration" });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("9s");
  });

  it("ends a forced replay whose animation is cancelled with nothing left in its place", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });
    h.setLiveAnimations("vm-heading", []);

    h.animationEvent("vm-heading", { type: "animationcancel" });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
  });

  it("ignores the cancel its own rewind causes, while an animation of that name is still live", () => {
    // `rewind()` writes `animation-name: none` before putting the name back; the browser cancels
    // the outgoing animation and delivers the event a frame later, once the replacement is
    // already running. Trusting it ended the replay the instant it started.
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });
    h.setLiveAnimations("vm-heading", ["vm-fade-in-up-v1-1-0"]);

    h.animationEvent("vm-heading", { type: "animationcancel" });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(h.el("vm-heading").style.getPropertyValue("animation-play-state")).toBe("running");

    // The replacement is what ends it.
    h.animationEvent("vm-heading");
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
  });

  it("keeps a held in-view element playing when its own rewind cancel arrives", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(held), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-play-state")).toBe("running");
    h.setLiveAnimations("vm-heading", ["vm-fade-in-up-v1-1-0"]);

    h.animationEvent("vm-heading", { type: "animationcancel" });

    expect(h.el("vm-heading").style.getPropertyValue("animation-play-state")).toBe("running");
  });

  it("does not rewind an in-view element that armed while the forced replay ran", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(held), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });
    // The designer scrolls down to watch the replay, so the trigger arms on its own.
    h.intersect("vm-heading", true);
    const writes = watchNameWrites(h, "vm-heading");

    h.animationEvent("vm-heading");

    // Its normal arm state is now "playing", so there is nothing to rewind it to: a third
    // `none` -> name pair here would be a third play the designer never asked for.
    expect(writes).toEqual([]);
    expect(h.el("vm-heading").style.getPropertyValue("animation-play-state")).toBe("running");
    expect(h.el("vm-heading").style.getPropertyValue("animation-delay")).toBe("300ms");
  });

  it("leaves a naturally armed element armed after animationend", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied(), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });

    h.animationEvent("vm-heading");

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("restarts on an animation change but not on a param-only change (spec §3)", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied(), seq: 1 });

    const names: string[] = [];
    const el = h.el("vm-heading");
    const original = el.style.setProperty.bind(el.style);
    vi.spyOn(el.style, "setProperty").mockImplementation((prop: string, value: string | null, priority?: string) => {
      if (prop === "animation-name") names.push(value ?? "");
      original(prop, value, priority);
    });

    h.send({ type: "apply", payload: applied({ style: { "animation-duration": "1200ms" } }), seq: 2 });
    expect(names).toEqual([]);

    h.send({
      type: "apply",
      payload: applied({ keyframesName: "vm-scale-in-v1-1-0", keyframesCss: "@keyframes vm-scale-in-v1-1-0 { to { transform: none } }" }),
      seq: 3,
    });
    // `none` then the new name, with no discarded full render in front of it.
    expect(names).toEqual(["none", "vm-scale-in-v1-1-0"]);
  });
});

describe("preview", () => {
  const previewAssignment = applied({
    keyframesName: "vm-pulse-v1-1-0",
    keyframesCss: "@keyframes vm-pulse-v1-1-0 { 50% { opacity: .5 } }",
    animationId: "pulse",
  });

  it("shows over the applied assignment and gives it back on preview:clear", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(), seq: 1 });

    h.send({ type: "preview", payload: previewAssignment, seq: 2 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");

    h.send({ type: "preview:clear", payload: {}, seq: 3 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 4 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("9s");
  });

  it("plays on an element with no assignment and leaves nothing behind", () => {
    const h = loadBridge(hostPage);

    h.send({ type: "preview", payload: previewAssignment, seq: 1 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");
    expect(h.runtimeCss()).toContain("@keyframes vm-pulse-v1-1-0");

    h.send({ type: "preview:clear", payload: {}, seq: 2 });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("9s");
    expect(h.runtimeCss()).not.toContain("@keyframes vm-pulse-v1-1-0");
  });

  it("plays regardless of the trigger", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "in-view" }), seq: 1 });

    h.send({ type: "preview", payload: { ...previewAssignment, trigger: "in-view" }, seq: 2 });

    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");
  });

  it("keeps at most one preview: a second one releases the first", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(), seq: 1 });
    h.send({ type: "preview", payload: previewAssignment, seq: 2 });

    h.send({ type: "preview", payload: { ...previewAssignment, vmId: "vm-button" }, seq: 3 });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(h.el("vm-button").style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");
  });

  it("lets an apply during a preview update only the layer underneath", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(), seq: 1 });
    h.send({ type: "preview", payload: previewAssignment, seq: 2 });

    h.send({
      type: "apply",
      payload: applied({ keyframesName: "vm-scale-in-v1-1-0", keyframesCss: "@keyframes vm-scale-in-v1-1-0 { to { transform: none } }" }),
      seq: 3,
    });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");

    h.send({ type: "preview:clear", payload: {}, seq: 4 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-scale-in-v1-1-0");
  });

  it("reference-counts preview keyframes alongside applied ones", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ vmId: "vm-button" }), seq: 1 });

    h.send({ type: "preview", payload: applied({ vmId: "vm-heading" }), seq: 2 });
    expect(h.runtimeCss().split("@keyframes vm-fade-in-up-v1-1-0").length - 1).toBe(1);

    h.send({ type: "preview:clear", payload: {}, seq: 3 });
    expect(h.runtimeCss()).toContain("@keyframes vm-fade-in-up-v1-1-0");

    h.send({ type: "clear", payload: { vmId: "vm-button" }, seq: 4 });
    expect(h.runtimeCss()).not.toContain("@keyframes vm-fade-in-up-v1-1-0");
  });

  it("is not restarted by an apply underneath it (spec D6)", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(), seq: 1 });
    h.send({ type: "preview", payload: previewAssignment, seq: 2 });
    const writes: string[] = [];
    const el = h.el("vm-heading");
    const write = el.style.setProperty.bind(el.style);
    vi.spyOn(el.style, "setProperty").mockImplementation((prop: string, value: string | null, priority?: string) => {
      if (prop === "animation-name") writes.push(value ?? "");
      write(prop, value, priority);
    });

    h.send({
      type: "apply",
      payload: applied({
        keyframesName: "vm-scale-in-v1-1-0",
        keyframesCss: "@keyframes vm-scale-in-v1-1-0 { to { transform: none } }",
      }),
      seq: 3,
    });

    expect(writes).toEqual([]);
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");
  });

  it("sits out an in-view arm transition and catches up when it clears (spec D4)", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(held), seq: 1 });
    h.send({ type: "preview", payload: previewAssignment, seq: 2 });
    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");
    const writes = watchNameWrites(h, "vm-heading");

    // A preview belongs to the catalog card under the pointer, not to the scroll position.
    h.intersect("vm-heading", true);
    expect(writes).toEqual([]);
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-pulse-v1-1-0");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");

    // Clearing it lands on the arm state the element reached while the preview was up.
    h.send({ type: "preview:clear", payload: {}, seq: 3 });
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");
    expect(el.style.getPropertyValue("animation-delay")).toBe("300ms");
  });

  it("returns a still-unarmed in-view element to a fresh held animation when it clears", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(held), seq: 1 });
    h.send({ type: "preview", payload: previewAssignment, seq: 2 });
    const writes = watchNameWrites(h, "vm-heading");

    h.send({ type: "preview:clear", payload: {}, seq: 3 });

    expect(writes).toEqual(["none", "vm-fade-in-up-v1-1-0"]);
    expect(h.el("vm-heading").style.getPropertyValue("animation-play-state")).toBe("paused");
  });

  it("is dropped by state:load", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "preview", payload: previewAssignment, seq: 1 });

    h.send({ type: "state:load", payload: { assignments: [applied({ vmId: "vm-button" })] }, seq: 2 });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("9s");
    expect(h.runtimeCss()).not.toContain("@keyframes vm-pulse-v1-1-0");

    h.send({ type: "preview:clear", payload: {}, seq: 3 });
    expect(h.el("vm-button").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("rejects a malformed preview", () => {
    const h = loadBridge(hostPage);

    h.send({ type: "preview", payload: applied({ style: { color: "red" } }), seq: 1 });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "invalid-payload" });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
  });
});
