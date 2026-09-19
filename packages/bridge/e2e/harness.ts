/**
 * Real-browser harness for the bridge.
 *
 * The test page is the editor shell on one origin; the framed page is the cloned page on another,
 * loading the *unmodified* `src/vm-bridge.js`. Both, and the script, are fulfilled by
 * `page.route`, so there is no API, no Next app and nothing to start. A third origin is routed too
 * so a foreign frame can try to talk to the bridge.
 *
 * This suite covers what `test/*.test.ts` structurally cannot: real animations (`getAnimations()`,
 * `animationstart`/`animationend`/`animationiteration`), real layout, a real
 * `IntersectionObserver`, a real CSSOM and a real cascade.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Frame, Page } from "@playwright/test";

import type { AppliedAssignment } from "../src/protocol";

const here = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_SOURCE = readFileSync(path.join(here, "..", "src", "vm-bridge.js"), "utf8");

export const SHELL_ORIGIN = "http://shell.test";
export const FRAME_ORIGIN = "http://frame.test";
export const FOREIGN_ORIGIN = "http://evil.test";

export type Ack = { seq: number; ms: number; ok: boolean; error?: string; unknownVmIds?: string[] };

export type BridgeHarness = {
  page: Page;
  frame: Frame;
  /** Post a message as the shell and resolve with its ack. */
  send(type: string, payload: unknown): Promise<Ack>;
  /** Every `{source:"vibe-motion"}` message the shell received, oldest first. */
  messages(type?: string): Promise<Array<{ type: string; payload: Record<string, unknown> }>>;
  /** `getAnimations()` on one tagged element, as plain data. */
  animations(vmId: string): Promise<Array<{ name: string; time: number; state: string }>>;
  /** One computed style property of a tagged element. */
  computed(vmId: string, prop: string): Promise<string>;
  /** The element's inline value for one property. */
  inline(vmId: string, prop: string): Promise<string>;
  /** How many `animationstart` events fired inside the frame for this keyframes name. */
  starts(name: string): Promise<number>;
  /**
   * Sample an element's animation once per frame for `ms`, from inside the frame.
   *
   * A single `getAnimations()` round trip after a fixed wait races anything the browser delivers
   * asynchronously — an `animationcancel` a frame or two late will sometimes be missed. Sampling
   * every frame turns "it kept playing" into a deterministic assertion.
   */
  sample(vmId: string, ms: number): Promise<Array<{ name: string; time: number; state: string } | null>>;
  rect(selector: string): Promise<{ x: number; y: number; width: number; height: number }>;
};

const SHELL_HTML = `<!doctype html><html><body style="margin:0">
<iframe id="f" src="${FRAME_ORIGIN}/page" sandbox="allow-scripts allow-same-origin"
        style="width:800px;height:600px;border:0"></iframe>
<iframe id="evil" src="${FOREIGN_ORIGIN}/page" style="width:0;height:0;border:0"></iframe>
<script>
  window.__msgs = [];
  window.__acks = {};
  var seq = 0;
  addEventListener("message", function (e) {
    if (!e.data || e.data.source !== "vibe-motion") return;
    window.__msgs.push(e.data);
    if (e.data.type === "ack") {
      var waiting = window.__acks[e.data.payload.seq];
      if (waiting) waiting(e.data.payload);
    }
  });
  window.__send = function (type, payload) {
    return new Promise(function (resolve) {
      var s = ++seq;
      window.__acks[s] = resolve;
      document.getElementById("f").contentWindow.postMessage(
        { source: "vibe-motion", type: type, payload: payload, seq: s }, "${FRAME_ORIGIN}");
    });
  };
</script></body></html>`;

/** A frame on a third origin that reaches its sibling through `parent.frames[0]`. */
const FOREIGN_HTML = `<!doctype html><html><body><script>
  window.__attack = function (seq) {
    parent.frames[0].postMessage(
      { source: "vibe-motion", type: "apply", payload: window.__payload, seq: seq }, "${FRAME_ORIGIN}");
  };
</script></body></html>`;

export function framePage(body: string, head = ""): string {
  return `<!doctype html><html><head><style>
      body { margin: 0; font: 14px/1.4 system-ui, sans-serif }
      .box { width: 200px; height: 60px; margin: 20px; background: #ddd }
      .spacer { height: 2000px }
    </style>${head}</head><body>
    ${body}
    <script src="/vm-bridge.js" data-vm-parent-origin="${SHELL_ORIGIN}" defer></script>
  </body></html>`;
}

export function assignment(vmId: string, over: Partial<AppliedAssignment> = {}): AppliedAssignment {
  return {
    vmId,
    trigger: "load",
    keyframesName: "vm-fade-v1-0-0",
    keyframesCss: "@keyframes vm-fade-v1-0-0 { from { opacity: 0 } to { opacity: 1 } }",
    style: { "animation-duration": "5s", "animation-fill-mode": "both" },
    baseStyles: "",
    animationId: "fade",
    catalogVersion: "1.0.0",
    params: {},
    ...over,
  };
}

export async function mountBridge(page: Page, body: string, head = ""): Promise<BridgeHarness> {
  await page.route(`${SHELL_ORIGIN}/`, (route) => route.fulfill({ contentType: "text/html", body: SHELL_HTML }));
  await page.route(`${FRAME_ORIGIN}/page`, (route) =>
    route.fulfill({ contentType: "text/html", body: framePage(body, head) }),
  );
  await page.route(`${FRAME_ORIGIN}/vm-bridge.js`, (route) =>
    route.fulfill({ contentType: "text/javascript", body: BRIDGE_SOURCE }),
  );
  await page.route(`${FOREIGN_ORIGIN}/page`, (route) =>
    route.fulfill({ contentType: "text/html", body: FOREIGN_HTML }),
  );

  await page.goto(`${SHELL_ORIGIN}/`);
  await page.waitForFunction(() => window.__msgs.some((m) => m.type === "ready"));

  const frame = page.frames().find((f) => f.url().startsWith(FRAME_ORIGIN));
  if (!frame) throw new Error("the framed page never loaded");

  // Count animationstart per keyframes name; installed before any assignment is applied.
  await frame.evaluate(() => {
    window.__starts = {};
    document.addEventListener(
      "animationstart",
      (event) => {
        const name = (event as AnimationEvent).animationName;
        window.__starts[name] = (window.__starts[name] ?? 0) + 1;
      },
      true,
    );
  });

  return {
    page,
    frame,
    send: (type, payload) => page.evaluate(([t, p]) => window.__send(t as string, p), [type, payload] as const),
    messages: async (type) => {
      const all = await page.evaluate(() => window.__msgs);
      return type ? all.filter((m) => m.type === type) : all;
    },
    animations: (vmId) =>
      frame.evaluate((id) => {
        const el = document.querySelector(`[data-vm-id="${id}"]`);
        if (!el) return [];
        return el.getAnimations().map((a) => ({
          name: (a as CSSAnimation).animationName ?? "",
          time: Math.round(Number(a.currentTime ?? 0)),
          state: a.playState,
        }));
      }, vmId),
    computed: (vmId, prop) =>
      frame.evaluate(
        ([id, p]) => {
          const el = document.querySelector(`[data-vm-id="${id}"]`);
          return el ? getComputedStyle(el).getPropertyValue(p).trim() : "";
        },
        [vmId, prop] as const,
      ),
    inline: (vmId, prop) =>
      frame.evaluate(
        ([id, p]) => {
          const el = document.querySelector<HTMLElement>(`[data-vm-id="${id}"]`);
          return el ? el.style.getPropertyValue(p) : "";
        },
        [vmId, prop] as const,
      ),
    starts: (name) => frame.evaluate((n) => window.__starts[n] ?? 0, name),
    sample: (vmId, ms) =>
      frame.evaluate(
        ([id, duration]) =>
          new Promise<Array<{ name: string; time: number; state: string } | null>>((resolve) => {
            const el = document.querySelector(`[data-vm-id="${id}"]`);
            const out: Array<{ name: string; time: number; state: string } | null> = [];
            const started = performance.now();
            const tick = () => {
              const animation = el?.getAnimations()[0];
              out.push(
                animation
                  ? {
                      name: (animation as CSSAnimation).animationName ?? "",
                      time: Math.round(Number(animation.currentTime ?? 0)),
                      state: animation.playState,
                    }
                  : null,
              );
              if (performance.now() - started < (duration as number)) requestAnimationFrame(tick);
              else resolve(out);
            };
            requestAnimationFrame(tick);
          }),
        [vmId, ms] as const,
      ),
    rect: (selector) =>
      frame.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) throw new Error(`no element for ${sel}`);
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      }, selector),
  };
}

declare global {
  interface Window {
    __msgs: Array<{ type: string; payload: Record<string, unknown> }>;
    __acks: Record<number, (ack: Ack) => void>;
    __send: (type: string, payload: unknown) => Promise<Ack>;
    __starts: Record<string, number>;
    __payload: unknown;
    __attack: (seq: number) => void;
  }
}
