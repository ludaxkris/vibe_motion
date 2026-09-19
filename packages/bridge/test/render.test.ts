import { describe, expect, it, vi, afterEach } from "vitest";

import { BRIDGE_SOURCE, FIXTURE, applied, destroyAll, loadBridge, page } from "./harness";
import { KEYFRAMES_NAME_RE, STYLE_KEY_RE, VM_ID_RE } from "../src/protocol";

afterEach(destroyAll);

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

    const sheet = h.runtimeSheet();
    expect(sheet).not.toBeNull();
    const before = h.runtimeRules();
    const insert = vi.spyOn(sheet as CSSStyleSheet, "insertRule");
    const remove = vi.spyOn(sheet as CSSStyleSheet, "deleteRule");

    h.send({
      type: "apply",
      payload: applied({ style: { "animation-duration": "1200ms", "--vm-distance": "24px" } }),
      seq: 2,
    });

    expect(insert).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(h.runtimeRules()).toEqual(before);
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
    expect(h.keyframeNames()).toEqual([]);
  });

  it("rejects an assignment for an element the page does not have", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied({ vmId: "vm-nope" }), seq: 1 });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "unknown-element" });
    expect(h.keyframeNames()).toEqual([]);
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

    expect(h.keyframeNames().sort()).toEqual(["vm-fade-in-up-v1-1-0", "vm-scale-in-v1-1-0"]);
    expect(h.runtimeCss()).toContain('[data-vm-id="vm-heading"] { transform-origin: top; }');
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
    expect(h.keyframeNames()).toEqual([]);
  });
});

describe("the runtime stylesheet is driven through CSSOM", () => {
  it("rejects keyframes css that is not exactly one @keyframes rule with the promised name", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied({ keyframesCss: "body { display: none }" }), seq: 1 });
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "invalid-payload" });

    h.send({
      type: "apply",
      payload: applied({ keyframesCss: "@keyframes vm-other-v1-1-0 { to { opacity: 1 } }" }),
      seq: 2,
    });
    expect(h.lastAck()).toMatchObject({ seq: 2, ok: false, error: "invalid-payload" });

    expect(h.keyframeNames()).toEqual([]);
    expect(h.el("vm-heading").getAttribute("style")).toBeNull();
  });

  it("rejects a second body for a keyframes name already in use", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ vmId: "vm-heading" }), seq: 1 });

    h.send({
      type: "apply",
      payload: applied({
        vmId: "vm-button",
        keyframesCss: "@keyframes vm-fade-in-up-v1-1-0 { to { opacity: 0.5 } }",
      }),
      seq: 2,
    });

    expect(h.lastAck()).toMatchObject({ seq: 2, ok: false, error: "invalid-payload" });
    expect(h.el("vm-button").getAttribute("style")).toBeNull();
    expect(h.keyframeNames()).toEqual(["vm-fade-in-up-v1-1-0"]);
  });

  it("keeps base styles inside their own rule", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied({ baseStyles: "color:red } body { display:none } x{" }), seq: 1 });

    expect(h.runtimeCss()).not.toContain("body");
    expect(h.runtimeRules().filter((rule) => rule.indexOf("[data-vm-id=") === 0)).toHaveLength(1);
  });

  it("never adopts a vm-runtime element the page already had", () => {
    const h = loadBridge(
      page('<style id="vm-runtime">.host { color: red }</style><h1 data-vm-id="vm-heading">Hi</h1>'),
    );

    h.send({ type: "apply", payload: applied(), seq: 1 });

    const all = Array.from(h.document.querySelectorAll<HTMLStyleElement>("style#vm-runtime"));
    expect(all).toHaveLength(2);
    // The page's own rules are still there, untouched and still ours to leave alone.
    expect(all.some((style) => style.textContent === ".host { color: red }")).toBe(true);
    expect(h.keyframeNames()).toEqual(["vm-fade-in-up-v1-1-0"]);
  });
});

describe("state:load stylesheet budget (spec §6)", () => {
  it("inserts one rule per distinct keyframes name plus one per base-styles entry", () => {
    const h = loadBridge(FIXTURE);
    const sheet = h.runtimeSheet() as CSSStyleSheet;
    const insert = vi.spyOn(sheet, "insertRule");
    const scale = {
      keyframesName: "vm-scale-in-v1-1-0",
      keyframesCss: "@keyframes vm-scale-in-v1-1-0 { to { transform: none } }",
    };

    // Three assignments, two distinct keyframes names, one non-empty baseStyles.
    h.send({
      type: "state:load",
      payload: {
        assignments: [
          applied({ vmId: "vm-heading", ...scale }),
          applied({ vmId: "vm-button", ...scale, baseStyles: "transform-origin: top;" }),
          applied({ vmId: "vm-para" }),
        ],
      },
      seq: 1,
    });

    expect(insert).toHaveBeenCalledTimes(3);
    expect(h.keyframeNames().sort()).toEqual(["vm-fade-in-up-v1-1-0", "vm-scale-in-v1-1-0"]);
    // Nothing inserted twice.
    expect(new Set(h.runtimeRules()).size).toBe(h.runtimeRules().length);
  });

  it("does not grow the sheet when the same state is loaded again", () => {
    const h = loadBridge(FIXTURE);
    const payload = {
      assignments: [
        applied({ vmId: "vm-heading", baseStyles: "transform-origin: top;" }),
        applied({ vmId: "vm-button" }),
      ],
    };
    h.send({ type: "state:load", payload, seq: 1 });
    const before = h.runtimeRules();

    h.send({ type: "state:load", payload, seq: 2 });
    h.send({ type: "state:load", payload, seq: 3 });

    expect(h.runtimeRules()).toEqual(before);
    expect((h.runtimeSheet() as CSSStyleSheet).cssRules.length).toBe(before.length);
  });
});

describe("a rejected apply leaves nothing behind", () => {
  const badKeyframes = { keyframesCss: "@keyframes vm-somewhere-else-v1-1-0 { to { opacity: 1 } }" };

  it("does not disturb an assignment already on the element", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ baseStyles: "transform-origin: center;" }), seq: 1 });

    h.send({ type: "apply", payload: applied({ ...badKeyframes }), seq: 2 });

    expect(h.lastAck()).toMatchObject({ seq: 2, ok: false, error: "invalid-payload" });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
    expect(h.keyframeNames()).toEqual(["vm-fade-in-up-v1-1-0"]);
    expect(h.runtimeCss()).toContain('[data-vm-id="vm-heading"] { transform-origin: center; }');
  });

  it("leaves a fresh element exactly as it found it", () => {
    const h = loadBridge(
      page('<h1 data-vm-id="vm-heading" style="animation-duration: 9s">Hi</h1>'),
    );

    h.send({ type: "apply", payload: applied({ ...badKeyframes }), seq: 1 });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "invalid-payload" });
    expect(h.el("vm-heading").getAttribute("style")).toBe("animation-duration: 9s");
    expect(h.keyframeNames()).toEqual([]);

    // The record the rejected apply would otherwise have left behind must not make the next,
    // valid apply behave differently: the host's inline value is still snapshotted and restored.
    h.send({ type: "apply", payload: applied(), seq: 2 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("600ms");
    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 3 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-duration")).toBe("9s");
  });
});

describe("the runtime stylesheet survives its element being removed", () => {
  it("rebuilds every live rule rather than holding handles into a dead sheet", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied({ baseStyles: "transform-origin: center;" }), seq: 1 });

    const style = h.runtimeStyle() as HTMLStyleElement;
    style.parentNode?.removeChild(style);

    h.send({
      type: "apply",
      payload: applied({
        vmId: "vm-button",
        keyframesName: "vm-scale-in-v1-1-0",
        keyframesCss: "@keyframes vm-scale-in-v1-1-0 { to { transform: none } }",
      }),
      seq: 2,
    });

    expect(h.keyframeNames().sort()).toEqual(["vm-fade-in-up-v1-1-0", "vm-scale-in-v1-1-0"]);
    expect(h.runtimeCss()).toContain('[data-vm-id="vm-heading"] { transform-origin: center; }');

    // And the rebuilt handles are live, so releasing still removes the right rule.
    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 3 });
    expect(h.keyframeNames()).toEqual(["vm-scale-in-v1-1-0"]);
    expect(h.runtimeCss()).not.toContain('[data-vm-id="vm-heading"]');
  });
});

describe("the armed group is whole", () => {
  it("writes every animation longhand the style map leaves out at its initial value", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "apply", payload: applied({ style: { "animation-duration": "600ms" } }), seq: 1 });

    const el = h.el("vm-heading");
    // Without these, a host `animation: spin 2s linear infinite` would leave our animation
    // looping forever with the host's easing (spec D3).
    expect(el.style.getPropertyValue("animation-iteration-count")).toBe("1");
    expect(el.style.getPropertyValue("animation-timing-function")).toBe("ease");
    expect(el.style.getPropertyValue("animation-direction")).toBe("normal");
    expect(el.style.getPropertyValue("animation-fill-mode")).toBe("none");
    expect(el.style.getPropertyValue("animation-delay")).toBe("0s");
    expect(el.style.getPropertyPriority("animation-iteration-count")).toBe("important");
    // The style map still wins for everything it carries.
    expect(el.style.getPropertyValue("animation-duration")).toBe("600ms");
  });

  it("restores the host's values for the filled-in longhands on clear", () => {
    const h = loadBridge(
      page('<h1 data-vm-id="vm-heading" style="animation-iteration-count: infinite">Hi</h1>'),
    );
    h.send({ type: "apply", payload: applied({ style: { "animation-duration": "600ms" } }), seq: 1 });
    expect(h.el("vm-heading").style.getPropertyValue("animation-iteration-count")).toBe("1");

    h.send({ type: "clear", payload: { vmId: "vm-heading" }, seq: 2 });

    expect(h.el("vm-heading").style.getPropertyValue("animation-iteration-count")).toBe("infinite");
  });

  it("leaves the group alone entirely while unarmed", () => {
    const h = loadBridge(
      page('<h1 data-vm-id="vm-heading" style="animation-iteration-count: infinite">Hi</h1>'),
    );

    h.send({ type: "apply", payload: applied({ trigger: "hover" }), seq: 1 });

    expect(h.el("vm-heading").style.getPropertyValue("animation-iteration-count")).toBe("infinite");
  });
});

describe("acks", () => {
  it("names the vmIds a state:load could not place, without failing the batch", () => {
    const h = loadBridge(FIXTURE);

    h.send({
      type: "state:load",
      payload: { assignments: [applied({ vmId: "vm-heading" }), applied({ vmId: "vm-gone" })] },
      seq: 1,
    });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: true, unknownVmIds: ["vm-gone"] });
    expect(h.el("vm-heading").style.getPropertyValue("animation-name")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("reports an empty list when every vmId was found", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "state:load", payload: { assignments: [applied({ vmId: "vm-heading" })] }, seq: 1 });

    expect(h.lastAck()).toMatchObject({ seq: 1, ok: true, unknownVmIds: [] });
  });

  it("still fails a single message for an unknown element", () => {
    const h = loadBridge(FIXTURE);

    h.send({ type: "clear", payload: { vmId: "vm-gone" }, seq: 1 });
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false, error: "unknown-element" });

    h.send({ type: "select", payload: { vmId: "vm-gone" }, seq: 2 });
    expect(h.lastAck()).toMatchObject({ seq: 2, ok: false, error: "unknown-element" });

    h.send({ type: "replay", payload: { vmId: "vm-gone" }, seq: 3 });
    expect(h.lastAck()).toMatchObject({ seq: 3, ok: false, error: "unknown-element" });
  });

  it("rejects a replay whose payload has no vmId key at all", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "apply", payload: applied(), seq: 1 });

    h.send({ type: "replay", payload: {}, seq: 2 });

    // A shell bug that drops the field must surface, not silently restart the whole page.
    expect(h.lastAck()).toMatchObject({ seq: 2, ok: false, error: "invalid-payload" });
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
