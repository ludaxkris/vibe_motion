import { describe, expect, it } from "vitest";

import { BRIDGE_SOURCE, FIXTURE, applied, loadBridge, page } from "./harness";
import { KEYFRAMES_NAME_RE, STYLE_KEY_RE, VM_ID_RE } from "../src/protocol";

const KEYFRAMES = "@keyframes vm-fade-in-up-v1-1-0";

function countKeyframes(css: string, name = KEYFRAMES): number {
  return css.split(name).length - 1;
}

describe("apply", () => {
  it("writes the animation group !important, the custom properties plain, and one keyframes block", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied(), seq: 1 });

    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(el.style.getPropertyPriority("animation-name")).toBe("important");
    expect(el.style.getPropertyValue("animation-duration")).toBe("600ms");
    expect(el.style.getPropertyPriority("animation-duration")).toBe("important");
    expect(el.style.getPropertyValue("animation-play-state")).toBe("running");
    expect(el.style.getPropertyValue("--vm-distance")).toBe("24px");
    expect(countKeyframes(h.runtimeCss())).toBe(1);
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: true });
  });

  it("does not touch the stylesheet on a param-only change (spec §6 budget)", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied(), seq: 1 });

    const style = h.runtimeStyle();
    expect(style).not.toBeNull();
    const before = style?.textContent;
    const observer = new h.window.MutationObserver(() => {});
    observer.observe(style as Node, { childList: true, characterData: true, subtree: true });

    h.send({
      type: "apply",
      payload: applied({ style: { "animation-duration": "1200ms", "--vm-distance": "24px" } }),
      seq: 2,
    });

    expect(observer.takeRecords()).toEqual([]);
    expect(style?.textContent).toBe(before);
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("1200ms");
  });

  it("reference-counts keyframes across elements", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ vmId: "vm-heading" }), seq: 1 });
    h.send({ type: "apply", payload: applied({ vmId: "vm-button" }), seq: 2 });
    expect(countKeyframes(h.runtimeCss())).toBe(1);

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 3 });
    expect(countKeyframes(h.runtimeCss())).toBe(1);

    h.send({ type: "clear", payload: { vmId: "vm-button" }, seq: 4 });
    expect(countKeyframes(h.runtimeCss())).toBe(0);
  });

  it("drops a custom property that the new style map no longer carries", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied(), seq: 1 });
    expect(h.el("vm-heading").style.getPropertyValue("--vm-distance")).toBe("24px");

    h.send({ type: "apply", payload: applied({ style: { "animation-duration": "600ms" } }), seq: 2 });

    expect(h.el("vm-heading").style.getPropertyValue("--vm-distance")).toBe("");
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("600ms");
  });

  it("rejects a style key outside the allow-list and writes nothing", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied({ style: { color: "red" } }), seq: 1 });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "invalid-payload" });
    expect(h.el("vm-heading").getAttribute("style")).toBeNull();
    expect(h.runtimeCss()).toBe("");
  });

  it("rejects an assignment for an element the page does not have", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied({ vmId: "vm-nope" }), seq: 1 });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "unknown-element" });
    expect(h.runtimeCss()).toBe("");
  });

  it("emits one base-styles rule per assignment and removes it on clear", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied({ baseStyles: "transform-origin: center;" }), seq: 1 });
    expect(h.runtimeCss()).toContain('[data-vm-id="vm-heading"] { transform-origin: center; }');

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 2 });
    expect(h.runtimeCss()).not.toContain('[data-vm-id="vm-heading"]');
  });
});

describe("clear restores the host page's own inline styles", () => {
  const hostPage = page(`
    <h1 data-vm-id="vm-heading" style="animation-duration: 9s !important; color: red">Heading</h1>
    <p data-vm-id="vm-para" style="animation: spin 2s">Body</p>`);

  it("puts back the value and the priority it found", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(), seq: 1 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("600ms");

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 2 });

    const el = h.el("vm-heading");
    expect(el.style.getPropertyValue("animation-duration")).toBe("9s");
    expect(el.style.getPropertyPriority("animation-duration")).toBe("important");
    expect(el.style.getPropertyValue("color")).toBe("red");
    expect(el.style.getPropertyValue("--vm-distance")).toBe("");
    expect(el.style.getPropertyValue("animation-name")).toBe("");
    expect(h.lastAck()).toMatchObject({ seq: 2, ok: true });
  });

  it("never lets a second apply overwrite the snapshot", () => {
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied(), seq: 1 });
    h.send({ type: "apply", payload: applied({ style: { "animation-duration": "1200ms" } }), seq: 2 });
    h.send({ type: "apply", payload: applied({ style: { "animation-duration": "300ms" } }), seq: 3 });

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 4 });

    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("9s");
  });

  it("leaves a host `animation` shorthand declaration intact", () => {
    // jsdom's CSSOM does not expand the `animation` shorthand into longhands, so here the
    // shorthand simply survives untouched. In a browser the longhands it produced are what gets
    // snapshotted and restored one by one; either way nothing of the host's is lost.
    const h = loadBridge(hostPage);
    h.send({ type: "apply", payload: applied({ vmId: "vm-para" }), seq: 1 });

    h.send({ type: "clear", payload: { vmId: "vm-para" }, seq: 2 });

    const inline = h.el("vm-para").getAttribute("style") ?? "";
    expect(inline).toContain("animation: spin 2s");
    expect(inline).not.toContain("animation-name");
    expect(inline).not.toContain("--vm-distance");
  });
});

describe("state:load", () => {
  it("replaces every assignment and rewrites the stylesheet exactly once", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ vmId: "vm-heading" }), seq: 1 });
    h.send({ type: "apply", payload: applied({ vmId: "vm-button" }), seq: 2 });

    const style = h.runtimeStyle();
    const observer = new h.window.MutationObserver(() => {});
    observer.observe(style as Node, { childList: true, characterData: true, subtree: true });

    h.send({
      type: "state:load",
      payload: {
        assignments: [
          applied({ vmId: "vm-button", keyframesName: "vm-scale-in-v1-1-0", keyframesCss: "@keyframes vm-scale-in-v1-1-0 { to { transform: none } }" }),
          applied({ vmId: "vm-para", keyframesName: "vm-scale-in-v1-1-0", keyframesCss: "@keyframes vm-scale-in-v1-1-0 { to { transform: none } }" }),
          applied({ vmId: "vm-heading", baseStyles: "transform-origin: top;" }),
        ],
      },
      seq: 3,
    });

    expect(observer.takeRecords()).toHaveLength(1);
    const css = h.runtimeCss();
    expect(countKeyframes(css)).toBe(1);
    expect(countKeyframes(css, "@keyframes vm-scale-in-v1-1-0")).toBe(1);
    expect(css).toContain('[data-vm-id="vm-heading"] { transform-origin: top; }');
    expect(h.el("vm-button").style.getPropertyValue("animation-name")).toBe("vm-scale-in-v1-1-0");
    expect(h.el("vm-para").style.getPropertyValue("animation-name")).toBe("vm-scale-in-v1-1-0");
    expect(h.lastAck()).toMatchObject({ seq: 3, ok: true });
  });

  it("clears assignments that are not in the new list", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ vmId: "vm-heading" }), seq: 1 });
    h.send({ type: "apply", payload: applied({ vmId: "vm-button" }), seq: 2 });

    h.send({ type: "state:load", payload: { assignments: [applied({ vmId: "vm-para" })] }, seq: 3 });

    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("");
    expect(h.el("vm-button").style.getPropertyValue("animation-name")).toBe("");
    expect(h.el("vm-para").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(countKeyframes(h.runtimeCss())).toBe(1);
  });

  it("rejects the whole batch when one assignment is malformed", () => {
    const h = loadBridge(FIXTURE);

    h.send({
      type: "state:load",
      payload: { assignments: [applied({ vmId: "vm-heading" }), applied({ vmId: 'vm-1"]{}' })] },
      seq: 1,
    });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "invalid-payload" });
    expect(h.el("vm-heading").getAttribute("style")).toBeNull();
    expect(h.runtimeCss()).toBe("");
  });
});

describe("validation regexes", () => {
  it("are byte-identical to the ones exported from protocol.ts", () => {
    expect(BRIDGE_SOURCE).toContain(`var VM_ID_RE = /${VM_ID_RE.source}/;`);
    expect(BRIDGE_SOURCE).toContain(`var KEYFRAMES_NAME_RE = /${KEYFRAMES_NAME_RE.source}/;`);
    expect(BRIDGE_SOURCE).toContain(`var STYLE_KEY_RE = /${STYLE_KEY_RE.source}/;`);
  });

  it("never lets a wildcard target origin into the script", () => {
    expect(BRIDGE_SOURCE).not.toContain(', "*")');
    expect(BRIDGE_SOURCE).not.toContain('"*"');
  });
});
