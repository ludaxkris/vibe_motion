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
};

export type FakeObserver = {
  targets: Set<Element>;
  options: { threshold?: number | number[] } | undefined;
  disconnected: boolean;
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
  runtimeStyle(): HTMLStyleElement | null;
  runtimeCss(): string;
  overlay(): HTMLElement | null;
  /** Fire the shared IntersectionObserver for one element. */
  intersect(vmId: string, isIntersecting: boolean): void;
  observers(): FakeObserver[];
  /** Run every callback queued with `requestAnimationFrame` so far. */
  flushRaf(): void;
  mouse(type: string, target: Node, relatedTarget?: Node | null): void;
  click(target: Node): MouseEvent;
  keydown(key: string): void;
  animationEnd(vmId: string): void;
  destroy(): void;
};

export function loadBridge(html: string, opts: { parentOrigin?: string | null } = {}): Harness {
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
    constructor(cb: IoCallback, options?: { threshold?: number | number[] }) {
      this.options = options;
      observers.push(this);
      callbacks.set(this, cb);
    }
    observe(el: Element) {
      this.targets.add(el);
    }
    unobserve(el: Element) {
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

  // --- evaluate the script with a currentScript that carries the parent origin ----------------
  const scriptEl = document.createElement("script");
  if (parentOrigin !== null) scriptEl.setAttribute("data-vm-parent-origin", parentOrigin);
  document.head.appendChild(scriptEl);
  Object.defineProperty(document, "currentScript", { value: scriptEl, configurable: true });
  window.eval(BRIDGE_SOURCE);
  Object.defineProperty(document, "currentScript", { value: null, configurable: true });

  // jsdom's own DOMContentLoaded lands on the event loop later; tests are synchronous, so fire it
  // now. The bridge listens with `{ once: true }`, so the later one is a no-op.
  document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

  function el(vmId: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(`[data-vm-id="${vmId}"]`);
    if (!found) throw new Error(`no element with data-vm-id="${vmId}"`);
    return found;
  }

  return {
    window,
    document,
    sent,
    send(msg, sendOpts = {}) {
      const data: Record<string, unknown> = {
        source: msg.source === undefined ? MESSAGE_SOURCE : msg.source,
        type: msg.type,
        payload: msg.payload === undefined ? {} : msg.payload,
      };
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
      return document.getElementById("vm-runtime") as HTMLStyleElement | null;
    },
    runtimeCss() {
      const style = document.getElementById("vm-runtime");
      return style ? (style.textContent ?? "") : "";
    },
    overlay() {
      return document.querySelector<HTMLElement>("[data-vm-overlay]");
    },
    intersect(vmId, isIntersecting) {
      const target = el(vmId);
      for (const observer of observers) {
        if (!observer.targets.has(target)) continue;
        const cb = callbacks.get(observer);
        if (!cb) continue;
        cb(
          [
            {
              target,
              isIntersecting,
              intersectionRatio: isIntersecting ? 1 : 0,
              boundingClientRect: target.getBoundingClientRect(),
            },
          ],
          observer,
        );
      }
    },
    observers() {
      return observers;
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
    animationEnd(vmId) {
      el(vmId).dispatchEvent(new window.Event("animationend", { bubbles: true }));
    },
    destroy() {
      window.close();
    },
  };
}

/** A small page with three tagged elements, one of them wrapping an untagged `<span>`. */
export const FIXTURE = `<!doctype html><html><head><title>clone</title></head><body>
  <h1 data-vm-id="vm-heading">Hello   there,
     designer</h1>
  <button data-vm-id="vm-button" role="button"><span class="inner">Go</span></button>
  <p data-vm-id="vm-para">Body copy</p>
  <footer>untagged</footer>
</body></html>`;
