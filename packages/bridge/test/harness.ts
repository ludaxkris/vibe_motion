/**
 * Test harness: run the real `src/vm-bridge.js` inside a throwaway JSDOM.
 *
 * The script is loaded as a string and evaluated with `window.eval`, exactly as written — no
 * transform, no shim. Everything the frame needs but jsdom does not provide (a parent window,
 * `IntersectionObserver`, `requestAnimationFrame`) is installed on the window *before* the
 * script runs and is controllable from the returned harness, so tests stay synchronous.
 *
 * jsdom limits worth knowing when reading the tests:
 *   - no layout: `getBoundingClientRect()` is all zeros, so `ElementInfo.rect` and `.visible`
 *     carry no information here;
 *   - no real animations: nothing fires `animationend` on its own (`harness.animationEnd()`);
 *   - its CSSOM does not expand the `animation` shorthand into longhands.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

import { MESSAGE_SOURCE } from "../src/protocol";
import type { AppliedAssignment } from "../src/protocol";

const here = path.dirname(fileURLToPath(import.meta.url));

export const BRIDGE_SOURCE_PATH = path.join(here, "..", "src", "vm-bridge.js");
export const BRIDGE_SOURCE = readFileSync(BRIDGE_SOURCE_PATH, "utf8");

/** The editor shell's origin: what the API injects as `data-vm-parent-origin`. */
export const PARENT_ORIGIN = "http://localhost:3000";
/** The frame's own origin. Cross-origin with the shell in both real and mock mode (spec §2). */
export const FRAME_URL = "http://127.0.0.1:3000/mock-api/projects/p1/page";

export type Sent = { data: Record<string, unknown>; targetOrigin: string };
export type Ack = { seq: number; ms: number; ok: boolean; error?: string };

export type OutboundMessage = {
  type: string;
  payload: unknown;
  seq?: number;
  /** Override the envelope's `source` field to test the shape check. */
  source?: string;
};

export type SendOptions = {
  /** `MessageEvent.origin`; defaults to the parent origin. */
  origin?: string;
  /** `MessageEvent.source`; defaults to the stub standing in for `window.parent`. */
  source?: unknown;
  /**
   * Deliver `payload` exactly as given: `undefined` leaves the envelope with no `payload` key at
   * all and `null` stays `null`. Without this, `send` turns a missing payload into `{}`.
   */
  rawPayload?: boolean;
};

/**
 * What a test says about one element in an `IntersectionObserver` callback.
 *
 * Only `vmId` is required; each other field defaults to the plainest reading of the ones given,
 * so a test states the part it is about and nothing else.
 */
export type FakeEntry = {
  vmId: string;
  /**
   * Whether the element intersects the root **at all**. Not "past the threshold": with the
   * bridge's thresholds (`[0, IN_VIEW_THRESHOLD]`) a real observer reports `true` from zero-area
   * contact — edge-adjacent, before a single pixel shows — which is what the reachability clause
   * rides on. Defaults to `intersectionRatio > 0`, or `true` when no ratio is given either.
   */
  isIntersecting?: boolean;
  /** Intersected **area** over the element's whole area. Defaults to 1 intersecting, 0 not. */
  intersectionRatio?: number;
  /** The element's own box. jsdom has no layout, so a test that cares about size supplies one. */
  boundingClientRect?: { width: number; height: number };
  /**
   * The root's box, or `null` — which is what a real observer reports for an implicit root inside
   * a cross-origin iframe, i.e. always, for the bridge. `null` is the default for that reason; the
   * bridge then falls back to the root box the harness stubs (`rootSize()` / `resize()`).
   */
  rootBounds?: { width: number; height: number } | null;
};

export type FakeObserver = {
  targets: Set<Element>;
  options: { threshold?: number | number[] } | undefined;
  disconnected: boolean;
  /**
   * Every `observe` / `unobserve` in order, as `"observe:vm-heading"`. What a test asserts when it
   * cares that the bridge re-observed something, which `targets` alone cannot show.
   */
  calls: string[];
  /** Deliver several entries in one callback, the way a real observer batches them. */
  fire(entries: FakeEntry[]): void;
};

export type Harness = {
  window: Window & typeof globalThis;
  document: Document;
  /** Everything the bridge posted to the parent, oldest first. */
  sent: Sent[];
  send(msg: OutboundMessage, opts?: SendOptions): void;
  lastAck(): Ack | undefined;
  acks(): Ack[];
  /** Payloads of every message of `type` the bridge posted, oldest first. */
  payloads(type: string): unknown[];
  el(vmId: string): HTMLElement;
  /** The bridge's own `<style id="vm-runtime">`, which is the last one if the page had one too. */
  runtimeStyle(): HTMLStyleElement | null;
  runtimeSheet(): CSSStyleSheet | null;
  /** Its rules as text. The bridge drives the sheet through CSSOM, so the element has no text. */
  runtimeCss(): string;
  runtimeRules(): string[];
  /** The names of the `@keyframes` rules currently in the sheet, in order. */
  keyframeNames(): string[];
  overlay(): HTMLElement | null;
  /**
   * Fire the shared IntersectionObserver for one element. A boolean is the whole-element case
   * (`true` = fully on screen, ratio 1); an object states a ratio, a box or a `rootBounds`.
   */
  intersect(vmId: string, state?: boolean | Omit<FakeEntry, "vmId">): void;
  observers(): FakeObserver[];
  /**
   * The size the implicit `IntersectionObserver` root reports — `documentElement.clientWidth` /
   * `clientHeight`, which jsdom has none of and the harness supplies.
   */
  rootSize(): { width: number; height: number };
  /**
   * Resize that root *without* firing `resize`. The pane is already back but the event has not
   * run yet — which is when the browser delivers the entries that made the latch racy.
   */
  setRootSize(width: number, height: number): void;
  /** Resize that root and fire `resize`, the way dragging the editor's split pane does. */
  resize(width: number, height: number): void;
  /** Run every callback queued with `requestAnimationFrame` so far. */
  flushRaf(): void;
  mouse(type: string, target: Node, relatedTarget?: Node | null): void;
  click(target: Node): MouseEvent;
  keydown(key: string): void;
  /**
   * jsdom has no `AnimationEvent` and never runs an animation, so the event is built by hand.
   * It carries `animationName` and can be aimed at a descendant, because the bridge has to tell
   * its own animation ending from a host animation ending somewhere inside the element.
   */
  animationEvent(
    vmId: string,
    opts?: { type?: "animationend" | "animationiteration" | "animationcancel"; animationName?: string; target?: Node },
  ): void;
  /**
   * Install a fake `Element.getAnimations` on one element. jsdom has none, so without this the
   * bridge's "was this cancel ours?" check cannot be exercised in either direction.
   */
  setLiveAnimations(vmId: string, names: string[] | null, playState?: string): void;
  /** jsdom has no layout, so a test that cares about the overlay's box supplies one. */
  setRect(vmId: string, rect: { x: number; y: number; width: number; height: number }): void;
  /**
   * The same for the *layout* box the overlay reads while one of our animations is running:
   * `offsetLeft` / `offsetTop` / `offsetWidth` / `offsetHeight`, which jsdom reports as 0.
   *
   * jsdom also reports `offsetParent` as null, which the bridge reads as "these coordinates are
   * already viewport-relative" (what it would conclude for a `position: fixed` box), so it walks
   * no ancestors and no scroll offsets: whatever is passed here is exactly what `layoutBox()`
   * returns. Scrolling, resizing and reflowing for real is what `e2e/bridge.spec.ts` is for.
   */
  setOffsetBox(vmId: string, box: { left: number; top: number; width: number; height: number }): void;
  /** Put the body back and fire DOMContentLoaded, for a harness built with `beforeBody`. */
  completeLoad(): void;
  destroy(): void;
};

/**
 * The bridge's own `<style id="vm-runtime">`. A page may already carry that id (a page Vibe
 * Motion exported earlier, then re-cloned), and the bridge deliberately does not adopt it, so
 * the two are told apart by the cursor rule the bridge always inserts first.
 */
function bridgeStyle(document: Document): HTMLStyleElement | null {
  const all = Array.from(document.querySelectorAll<HTMLStyleElement>("style#vm-runtime"));
  const ours = all.find((style) => {
    const sheet = style.sheet;
    return !!sheet && Array.from(sheet.cssRules).some((rule) => rule.cssText.indexOf("data-vm-mode") >= 0);
  });
  return ours ?? null;
}

/**
 * Every harness built so far. Each one holds a JSDOM window with document-level capture
 * listeners on it, so `afterEach(destroyAll)` in each spec file keeps them from piling up.
 */
const live: Harness[] = [];

export function destroyAll(): void {
  while (live.length) live.pop()?.destroy();
}

export function loadBridge(
  html: string,
  opts: {
    parentOrigin?: string | null;
    /**
     * Evaluate the script with no `<body>` in the document and without firing DOMContentLoaded,
     * which is what a bridge injected into `<head>` without `defer` would see. `completeLoad()`
     * puts the document back together.
     */
    beforeBody?: boolean;
  } = {},
): Harness {
  const parentOrigin = opts.parentOrigin === undefined ? PARENT_ORIGIN : opts.parentOrigin;
  const dom = new JSDOM(html, { runScripts: "outside-only", url: FRAME_URL });
  const window = dom.window as unknown as Window & typeof globalThis;
  const document = window.document;

  const sent: Sent[] = [];
  const parentStub = {
    postMessage(data: Record<string, unknown>, targetOrigin: string) {
      sent.push({ data, targetOrigin });
    },
  };
  Object.defineProperty(window, "parent", { value: parentStub, configurable: true, writable: true });

  // --- fake IntersectionObserver (jsdom has none) --------------------------------------------
  const observers: FakeObserver[] = [];
  type IoCallback = (entries: unknown[], observer: unknown) => void;
  const callbacks = new Map<FakeObserver, IoCallback>();
  class FakeIntersectionObserver {
    targets = new Set<Element>();
    options: { threshold?: number | number[] } | undefined;
    disconnected = false;
    calls: string[] = [];
    constructor(cb: IoCallback, options?: { threshold?: number | number[] }) {
      this.options = options;
      observers.push(this);
      callbacks.set(this, cb);
    }
    fire(entries: FakeEntry[]) {
      const cb = callbacks.get(this);
      if (!cb) return;
      cb(
        entries.map((entry) => {
          const target = el(entry.vmId);
          const ratioGiven = entry.intersectionRatio;
          const isIntersecting = entry.isIntersecting ?? (ratioGiven === undefined ? true : ratioGiven > 0);
          return {
            target,
            isIntersecting,
            intersectionRatio: ratioGiven ?? (isIntersecting ? 1 : 0),
            boundingClientRect: entry.boundingClientRect ?? target.getBoundingClientRect(),
            rootBounds: entry.rootBounds ?? null,
          };
        }),
        this,
      );
    }
    observe(el: Element) {
      this.calls.push(`observe:${el.getAttribute("data-vm-id") ?? "?"}`);
      this.targets.add(el);
    }
    unobserve(el: Element) {
      this.calls.push(`unobserve:${el.getAttribute("data-vm-id") ?? "?"}`);
      this.targets.delete(el);
    }
    disconnect() {
      this.targets.clear();
      this.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  }
  Object.defineProperty(window, "IntersectionObserver", {
    value: FakeIntersectionObserver,
    configurable: true,
    writable: true,
  });

  // --- a viewport for the implicit IntersectionObserver root ----------------------------------
  // jsdom has no layout, so `document.documentElement.clientWidth` / `clientHeight` are 0 — and in
  // a standards-mode document those are what the bridge measures the root with whenever
  // `rootBounds` is null, which inside a cross-origin frame is always. A root with no area is not
  // on screen at all, so without this every entry would be held. The document gets the same
  // viewport jsdom gives `window`, and both move together, so a test cannot leave the two
  // disagreeing and no assertion depends on which of them the code under test happens to read
  // (the bridge reads `documentElement` for the observer root and `window` for
  // `elements:list.viewport`).
  function setRootSize(width: number, height: number) {
    Object.defineProperty(document.documentElement, "clientWidth", { value: width, configurable: true });
    Object.defineProperty(document.documentElement, "clientHeight", { value: height, configurable: true });
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  }
  setRootSize(window.innerWidth, window.innerHeight);

  // --- controllable requestAnimationFrame ----------------------------------------------------
  let rafId = 0;
  let rafQueue: Array<{ id: number; cb: (t: number) => void }> = [];
  Object.defineProperty(window, "requestAnimationFrame", {
    value: (cb: (t: number) => void) => {
      rafId += 1;
      rafQueue.push({ id: rafId, cb });
      return rafId;
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "cancelAnimationFrame", {
    value: (id: number) => {
      rafQueue = rafQueue.filter((entry) => entry.id !== id);
    },
    configurable: true,
    writable: true,
  });

  const detachedBody = opts.beforeBody ? document.body : null;
  if (detachedBody) document.documentElement.removeChild(detachedBody);

  // --- evaluate the script with a currentScript that carries the parent origin ----------------
  const scriptEl = document.createElement("script");
  if (parentOrigin !== null) scriptEl.setAttribute("data-vm-parent-origin", parentOrigin);
  document.head.appendChild(scriptEl);
  Object.defineProperty(document, "currentScript", { value: scriptEl, configurable: true });
  window.eval(BRIDGE_SOURCE);
  Object.defineProperty(document, "currentScript", { value: null, configurable: true });

  // jsdom's own DOMContentLoaded lands on the event loop later; tests are synchronous, so fire it
  // now. The bridge listens with `{ once: true }`, so the later one is a no-op.
  if (!detachedBody) document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

  function el(vmId: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`[data-vm-id="${vmId}"]`);
    if (!found) throw new Error(`no element with data-vm-id="${vmId}"`);
    return found;
  }

  const harness: Harness = {
    window,
    document,
    sent,
    send(msg, sendOpts = {}) {
      const data: Record<string, unknown> = {
        source: msg.source === undefined ? MESSAGE_SOURCE : msg.source,
        type: msg.type,
      };
      if (!sendOpts.rawPayload) data.payload = msg.payload === undefined ? {} : msg.payload;
      else if (msg.payload !== undefined) data.payload = msg.payload;
      if (msg.seq !== undefined) data.seq = msg.seq;
      const event = new window.MessageEvent("message", {
        data,
        origin: sendOpts.origin === undefined ? PARENT_ORIGIN : sendOpts.origin,
      });
      const source = sendOpts.source === undefined ? parentStub : sendOpts.source;
      Object.defineProperty(event, "source", { value: source, configurable: true });
      window.dispatchEvent(event);
    },
    acks() {
      return sent.filter((s) => s.data.type === "ack").map((s) => s.data.payload as Ack);
    },
    lastAck() {
      const all = sent.filter((s) => s.data.type === "ack");
      return all.length ? (all[all.length - 1].data.payload as Ack) : undefined;
    },
    payloads(type) {
      return sent.filter((s) => s.data.type === type).map((s) => s.data.payload);
    },
    el,
    runtimeStyle() {
      return bridgeStyle(document);
    },
    runtimeSheet() {
      return bridgeStyle(document)?.sheet ?? null;
    },
    runtimeRules() {
      const sheet = bridgeStyle(document)?.sheet;
      return sheet ? Array.from(sheet.cssRules).map((rule) => rule.cssText) : [];
    },
    runtimeCss() {
      const sheet = bridgeStyle(document)?.sheet;
      return sheet
        ? Array.from(sheet.cssRules)
            .map((rule) => rule.cssText)
            .join("\n")
        : "";
    },
    keyframeNames() {
      const sheet = bridgeStyle(document)?.sheet;
      if (!sheet) return [];
      return Array.from(sheet.cssRules)
        .filter((rule): rule is CSSKeyframesRule => rule.type === 7)
        .map((rule) => rule.name);
    },
    overlay() {
      return document.querySelector<HTMLElement>("[data-vm-overlay]");
    },
    intersect(vmId, state = true) {
      const target = el(vmId);
      const entry: FakeEntry = typeof state === "boolean" ? { vmId, isIntersecting: state } : { vmId, ...state };
      for (const observer of observers) {
        if (observer.targets.has(target)) observer.fire([entry]);
      }
    },
    observers() {
      return observers;
    },
    rootSize() {
      return { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    },
    setRootSize,
    resize(width, height) {
      setRootSize(width, height);
      window.dispatchEvent(new window.Event("resize"));
    },
    flushRaf() {
      const due = rafQueue;
      rafQueue = [];
      for (const entry of due) entry.cb(0);
    },
    mouse(type, target, relatedTarget = null) {
      // jsdom has no constructible PointerEvent payload we need; MouseEvent carries
      // `relatedTarget` and the bridge only ever reads `target` / `relatedTarget`.
      const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, relatedTarget });
      target.dispatchEvent(event);
    },
    click(target) {
      const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    },
    keydown(key) {
      document.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    },
    completeLoad() {
      if (detachedBody && !detachedBody.parentNode) document.documentElement.appendChild(detachedBody);
      document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));
    },
    setLiveAnimations(vmId, names, playState = "running") {
      const target = el(vmId) as unknown as {
        getAnimations?: () => Array<{ animationName: string; playState: string }>;
      };
      if (names === null) {
        delete target.getAnimations;
        return;
      }
      target.getAnimations = () => names.map((animationName) => ({ animationName, playState }));
    },
    setRect(vmId, rect) {
      const target = el(vmId);
      target.getBoundingClientRect = () =>
        ({ ...rect, top: rect.y, left: rect.x, right: rect.x + rect.width, bottom: rect.y + rect.height, toJSON: () => rect }) as DOMRect;
    },
    setOffsetBox(vmId, box) {
      const target = el(vmId);
      const values: Record<string, number> = {
        offsetLeft: box.left,
        offsetTop: box.top,
        offsetWidth: box.width,
        offsetHeight: box.height,
      };
      for (const name of Object.keys(values)) {
        Object.defineProperty(target, name, { value: values[name], configurable: true });
      }
    },
    animationEvent(vmId, opts = {}) {
      const event = new window.Event(opts.type ?? "animationend", { bubbles: true });
      Object.defineProperty(event, "animationName", {
        value: opts.animationName ?? "vm-fade-in-up-v1-1-0",
        configurable: true,
      });
      (opts.target ?? el(vmId)).dispatchEvent(event);
    },
    destroy() {
      window.close();
    },
  };
  live.push(harness);
  return harness;
}

/**
 * A well-formed `AppliedAssignment`, the way the shell builds it from a draft assignment
 * (`apps/web/lib/bridge/to-applied.ts`, Phase 4 PR B).
 */
export function applied(over: Partial<AppliedAssignment> = {}): AppliedAssignment {
  return {
    vmId: "vm-heading",
    trigger: "load",
    keyframesName: "vm-fade-in-up-v1-1-0",
    keyframesCss:
      "@keyframes vm-fade-in-up-v1-1-0 { from { opacity: 0; transform: translateY(var(--vm-distance)); } to { opacity: 1; transform: none; } }",
    style: { "animation-duration": "600ms", "--vm-distance": "24px" },
    baseStyles: "",
    animationId: "fade-in-up",
    catalogVersion: "1.1.0",
    params: { duration: "600ms", distance: "24px" },
    ...over,
  };
}

/** A page whose tagged elements carry the inline styles a real cloned page would bring. */
export function page(body: string): string {
  return `<!doctype html><html><head><title>clone</title></head><body>${body}</body></html>`;
}

/** A small page with three tagged elements, one of them wrapping an untagged `<span>`. */
export const FIXTURE = `<!doctype html><html><head><title>clone</title></head><body>
  <h1 data-vm-id="vm-heading">Hello   there,
     designer</h1>
  <button data-vm-id="vm-button" role="button"><span class="inner">Go</span></button>
  <p data-vm-id="vm-para">Body copy</p>
  <footer>untagged</footer>
</body></html>`;
