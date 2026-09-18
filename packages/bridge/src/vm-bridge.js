/*
 * Vibe Motion preview bridge.
 *
 * Runs inside the cloned page's iframe. Served by the API at /bridge/vm-bridge.js (and by the
 * web mock route in mock mode) and injected at serve time, never stored in `projects.base_html`,
 * so the protocol can change without touching a single saved project.
 *
 * Contract: docs/plans/phase-4-bridge-protocol.md. Types: ./protocol.ts.
 *
 * Deliberately a plain classic script: one IIFE, no imports, no exports, no build step. The
 * frame's CSP is `script-src 'self'; connect-src 'none'`, so there is no eval, no inline script
 * creation and no network call anywhere in here. It runs unmodified in a browser and in jsdom.
 *
 * The bridge is a dumb renderer (spec D1): the shell computes every byte of CSS and sends it.
 * The bridge never reads the catalog and never builds a keyframes name.
 */
// @ts-check
(function () {
  "use strict";

  /** Parsed out of this file by the API at build time; never hand-synced into Kotlin. */
  var BRIDGE_VERSION = "1.0.0";
  var MESSAGE_SOURCE = "vibe-motion";
  var PROTOCOL_VERSION = 1;

  // Kept byte-for-byte in sync with src/protocol.ts (test/render.test.ts asserts it).
  var VM_ID_RE = /^vm-[a-z0-9-]+$/;
  var KEYFRAMES_NAME_RE = /^vm-[a-z0-9-]+$/;
  var STYLE_KEY_RE = /^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/;

  var ID_ATTR = "data-vm-id";
  var ID_SELECTOR = "[data-vm-id]";

  // ---------------------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------------------

  // Read at evaluation time: `document.currentScript` is only meaningful while the script runs.
  var ownScript = document.currentScript;
  var parentOrigin = (ownScript && ownScript.dataset && ownScript.dataset.vmParentOrigin) || null;

  var initialised = false;

  /** Tagged elements by vmId, built once so no message costs an attribute-selector scan. */
  var elements = /** @type {Map<string, Element>} */ (new Map());
  /** Document order among tagged elements, from 0. */
  var orders = /** @type {Map<string, number>} */ (new Map());

  /**
   * Post to the editor shell. Never falls back to a wildcard target origin: that would hand the
   * cloned page's contents to whatever frame happens to be embedding us.
   *
   * @param {string} type
   * @param {unknown} payload
   */
  function post(type, payload) {
    if (!parentOrigin || window.parent === window) return;
    try {
      window.parent.postMessage({ source: MESSAGE_SOURCE, type: type, payload: payload }, parentOrigin);
    } catch (error) {
      /* A blocked postMessage must not break the page the designer is looking at. */
    }
  }

  function now() {
    return window.performance && window.performance.now ? window.performance.now() : Date.now();
  }

  function buildElementMap() {
    elements = new Map();
    orders = new Map();
    var nodes = document.querySelectorAll(ID_SELECTOR);
    for (var i = 0; i < nodes.length; i += 1) {
      var vmId = nodes[i].getAttribute(ID_ATTR);
      if (!vmId || elements.has(vmId)) continue;
      elements.set(vmId, nodes[i]);
      orders.set(vmId, orders.size);
    }
  }

  function ensureInit() {
    if (initialised || !document.body) return;
    initialised = true;
    buildElementMap();
  }

  function announceReady() {
    ensureInit();
    post("ready", {
      elementCount: elements.size,
      bridgeVersion: BRIDGE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  // ---------------------------------------------------------------------------------------
  // Message dispatch
  // ---------------------------------------------------------------------------------------

  /**
   * Shell -> bridge handlers. A handler returns nothing when it succeeded, or a failure with the
   * `ack` error code. Types that are not in here are ignored on purpose, so the shell can add
   * message types (`mode`, `elements:query`) before every frame in the wild serves a new bridge.
   *
   * @type {Record<string, (payload: any) => { ok: boolean; error?: string } | void>}
   */
  var HANDLERS = {
    hello: function () {
      announceReady();
    },
  };

  /** @param {MessageEvent} event */
  function onMessage(event) {
    // Spec §2: origin, window, envelope shape and known type must all pass.
    if (!parentOrigin || event.origin !== parentOrigin) return;
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.source !== MESSAGE_SOURCE || typeof data.type !== "string") return;
    if (!Object.prototype.hasOwnProperty.call(HANDLERS, data.type)) return;
    var handler = HANDLERS[data.type];
    if (typeof handler !== "function") return;

    ensureInit();
    var started = now();
    var failure = null;
    try {
      failure = handler(data.payload) || null;
    } catch (error) {
      // A malformed payload must never leave the frame wedged.
      failure = { ok: false, error: "invalid-payload" };
    }
    if (typeof data.seq === "number") {
      var ack = /** @type {{ seq: number; ms: number; ok: boolean; error?: string }} */ ({
        seq: data.seq,
        ms: now() - started,
        ok: !failure,
      });
      if (failure && failure.error) ack.error = failure.error;
      post("ack", ack);
    }
  }

  window.addEventListener("message", onMessage, false);

  // Capture phase, so the page's own handlers never see the event: the clone is a canvas, not a
  // site. Scripts are stripped at clone time, but inline `href="javascript:"` and plain links are
  // not, and either one navigating away would lose the designer's unsaved work.
  document.addEventListener(
    "click",
    function (event) {
      event.preventDefault();
    },
    true,
  );

  document.addEventListener(
    "submit",
    function (event) {
      event.preventDefault();
    },
    true,
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceReady, { once: true });
  } else {
    announceReady();
  }
})();
