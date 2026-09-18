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
    expect(h.observers()[0].options?.threshold).toBe(IN_VIEW_THRESHOLD);
  });

  it("stops observing an element whose assignment is cleared", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "in-view" }), seq: 1 });
    expect(h.observers()[0].targets.size).toBe(1);

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 2 });

    expect(h.observers()[0].targets.size).toBe(0);
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

  it("replays every assigned element when vmId is null", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ vmId: "vm-heading" }), seq: 1 });
    h.send({ type: "apply", payload: applied({ vmId: "vm-button" }), seq: 2 });

    const flushed: string[] = [];
    vi.spyOn(h.window, "getComputedStyle").mockImplementation(((el: Element) => {
      flushed.push(el.getAttribute("data-vm-id") ?? "?");
      return { animationName: "none" } as unknown as CSSStyleDeclaration;
    }) as typeof h.window.getComputedStyle);

    h.send({ type: "replay", payload: { vmId: null }, seq: 3 });

    expect(flushed.sort()).toEqual(["vm-button", "vm-heading"]);
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

  it("ends a forced replay whose animation is cancelled", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });
    h.send({ type: "replay", payload: { vmId: "vm-heading" }, seq: 2 });

    h.animationEvent("vm-heading", { type: "animationcancel" });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
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
