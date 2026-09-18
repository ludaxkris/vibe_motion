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
  var RUNTIME_STYLE_ID = "vm-runtime";

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
  // Payload validation (spec D1)
  //
  // The bridge interpolates vmId into an attribute selector and keyframesName into a property
  // value, so both are checked against the same regexes the shell uses, and the style map may
  // only carry animation longhands (never animation-name, which the bridge owns) and --vm-*.
  // ---------------------------------------------------------------------------------------

  /**
   * @param {any} a
   * @returns {a is import("./protocol").AppliedAssignment}
   */
  function validateApplied(a) {
    if (!a || typeof a !== "object") return false;
    if (typeof a.vmId !== "string" || !VM_ID_RE.test(a.vmId)) return false;
    if (typeof a.keyframesName !== "string" || !KEYFRAMES_NAME_RE.test(a.keyframesName)) return false;
    if (a.trigger !== "load" && a.trigger !== "hover" && a.trigger !== "in-view") return false;
    if (typeof a.keyframesCss !== "string" || typeof a.baseStyles !== "string") return false;
    if (!a.style || typeof a.style !== "object") return false;
    for (var key in a.style) {
      if (!Object.prototype.hasOwnProperty.call(a.style, key)) continue;
      if (!STYLE_KEY_RE.test(key) || typeof a.style[key] !== "string") return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // The <style id="vm-runtime"> block
  //
  // Holds every @keyframes body in use (reference-counted, previews included) and one
  // `[data-vm-id="…"] { … }` rule per assignment with base styles. Written at most once per
  // message, and never at all when only a param changed (spec §6 budget).
  // ---------------------------------------------------------------------------------------

  var runtimeStyle = /** @type {HTMLStyleElement | null} */ (null);
  var runtimeText = "";
  var runtimeDirty = false;
  /** keyframesName -> the CSS body and how many assignments reference it. */
  var keyframeRefs = /** @type {Map<string, { css: string, count: number }>} */ (new Map());
  /** vmId -> the base-styles declarations of whatever is currently rendered on it. */
  var baseRules = /** @type {Map<string, string>} */ (new Map());

  function ensureRuntimeStyle() {
    if (runtimeStyle && runtimeStyle.parentNode) return runtimeStyle;
    var existing = document.getElementById(RUNTIME_STYLE_ID);
    if (existing) {
      runtimeStyle = /** @type {HTMLStyleElement} */ (existing);
      return runtimeStyle;
    }
    var created = document.createElement("style");
    created.id = RUNTIME_STYLE_ID;
    (document.head || document.documentElement).appendChild(created);
    runtimeStyle = created;
    return created;
  }

  /**
   * @param {string} name
   * @param {string} css
   */
  function acquireKeyframes(name, css) {
    var entry = keyframeRefs.get(name);
    if (entry) {
      entry.count += 1;
      if (entry.css !== css) {
        entry.css = css;
        runtimeDirty = true;
      }
      return;
    }
    keyframeRefs.set(name, { css: css, count: 1 });
    runtimeDirty = true;
  }

  /** @param {string | null | undefined} name */
  function releaseKeyframes(name) {
    if (!name) return;
    var entry = keyframeRefs.get(name);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    keyframeRefs.delete(name);
    runtimeDirty = true;
  }

  /**
   * @param {string} vmId
   * @param {string} css
   */
  function setBaseRule(vmId, css) {
    var current = baseRules.get(vmId) || "";
    var next = css || "";
    if (current === next) return;
    if (next) baseRules.set(vmId, next);
    else baseRules.delete(vmId);
    runtimeDirty = true;
  }

  function flushRuntime() {
    if (!runtimeDirty) return;
    runtimeDirty = false;
    var parts = /** @type {string[]} */ ([]);
    keyframeRefs.forEach(function (entry) {
      parts.push(entry.css);
    });
    baseRules.forEach(function (css, vmId) {
      parts.push("[" + ID_ATTR + '="' + vmId + '"] { ' + css + " }");
    });
    var text = parts.join("\n");
    if (text === runtimeText) return;
    runtimeText = text;
    ensureRuntimeStyle().textContent = text;
  }

  // ---------------------------------------------------------------------------------------
  // Per-element layers: original -> applied -> preview (spec D6)
  //
  // `original` is the host page's own inline value and priority for every property the bridge
  // ever touches on that element, snapshotted once and never while the bridge owns the property,
  // so a preview can never be mistaken for the page's own styling.
  // ---------------------------------------------------------------------------------------

  /**
   * @typedef {{
   *   vmId: string,
   *   el: HTMLElement,
   *   original: Map<string, { value: string, priority: string }>,
   *   owned: Set<string>,
   *   applied: import("./protocol").AppliedAssignment | null,
   *   preview: import("./protocol").AppliedAssignment | null,
   *   armed: boolean
   * }} ElementRecord
   */

  var records = /** @type {Map<string, ElementRecord>} */ (new Map());

  /**
   * @param {string} vmId
   * @returns {ElementRecord | null}
   */
  function recordFor(vmId) {
    var existing = records.get(vmId);
    if (existing) return existing;
    var el = elements.get(vmId);
    if (!el) return null;
    var record = {
      vmId: vmId,
      el: /** @type {HTMLElement} */ (el),
      original: /** @type {Map<string, { value: string, priority: string }>} */ (new Map()),
      owned: /** @type {Set<string>} */ (new Set()),
      applied: /** @type {import("./protocol").AppliedAssignment | null} */ (null),
      preview: /** @type {import("./protocol").AppliedAssignment | null} */ (null),
      armed: false,
    };
    records.set(vmId, record);
    return record;
  }

  /** What is rendered right now: a preview wins over the applied assignment (spec D4). */
  /** @param {ElementRecord} record */
  function effective(record) {
    return record.preview || record.applied;
  }

  /**
   * @param {ElementRecord} record
   * @param {string} prop
   */
  function snapshot(record, prop) {
    if (record.original.has(prop) || record.owned.has(prop)) return;
    record.original.set(prop, {
      value: record.el.style.getPropertyValue(prop),
      priority: record.el.style.getPropertyPriority(prop),
    });
  }

  /**
   * @param {ElementRecord} record
   * @param {string} prop
   */
  function restoreProp(record, prop) {
    var saved = record.original.get(prop);
    record.owned.delete(prop);
    if (saved && saved.value) record.el.style.setProperty(prop, saved.value, saved.priority);
    else record.el.style.removeProperty(prop);
  }

  /** @param {ElementRecord} record */
  function restoreAll(record) {
    var owned = /** @type {string[]} */ ([]);
    record.owned.forEach(function (prop) {
      owned.push(prop);
    });
    for (var i = 0; i < owned.length; i += 1) restoreProp(record, owned[i]);
  }

  /**
   * Make the element's inline style say exactly `desired` for the properties the bridge owns,
   * restoring the host's own value for anything it owned before and no longer wants.
   *
   * @param {ElementRecord} record
   * @param {Array<[string, string, boolean]>} desired  property, value, !important
   */
  function writeDesired(record, desired) {
    var wanted = /** @type {Set<string>} */ (new Set());
    for (var i = 0; i < desired.length; i += 1) {
      var prop = desired[i][0];
      wanted.add(prop);
      snapshot(record, prop);
      record.el.style.setProperty(prop, desired[i][1], desired[i][2] ? "important" : "");
      record.owned.add(prop);
    }
    var stale = /** @type {string[]} */ ([]);
    record.owned.forEach(function (prop) {
      if (!wanted.has(prop)) stale.push(prop);
    });
    for (var j = 0; j < stale.length; j += 1) restoreProp(record, stale[j]);
  }

  /**
   * The one place inline styles are written. `--vm-*` custom properties go on as soon as an
   * assignment exists (they are inert on their own); the whole `animation-*` group goes on
   * `!important` only while the trigger is armed, so our duration and delay never retime an
   * animation the host page was already running (spec D3).
   *
   * @param {ElementRecord} record
   */
  function render(record) {
    var assignment = effective(record);
    if (!assignment) {
      restoreAll(record);
      return;
    }
    var armed = record.preview ? true : record.armed;
    var desired = /** @type {Array<[string, string, boolean]>} */ ([]);
    var style = assignment.style;
    var key;
    for (key in style) {
      if (!Object.prototype.hasOwnProperty.call(style, key)) continue;
      if (key.indexOf("--") === 0) desired.push([key, style[key], false]);
    }
    if (armed) {
      desired.push(["animation-name", assignment.keyframesName, true]);
      for (key in style) {
        if (!Object.prototype.hasOwnProperty.call(style, key)) continue;
        if (key.indexOf("--") !== 0) desired.push([key, style[key], true]);
      }
      desired.push(["animation-play-state", "running", true]);
    }
    writeDesired(record, desired);
  }

  /** @param {ElementRecord} record */
  function syncBaseRule(record) {
    var assignment = effective(record);
    setBaseRule(record.vmId, assignment ? assignment.baseStyles : "");
  }

  /**
   * @param {ElementRecord} record
   * @param {import("./protocol").AppliedAssignment} assignment
   */
  function setApplied(record, assignment) {
    var previous = record.applied;
    // Acquire before releasing, so a param-only change on the same keyframes name never drops
    // the reference count to zero and rewrites the stylesheet for nothing.
    acquireKeyframes(assignment.keyframesName, assignment.keyframesCss);
    if (previous) releaseKeyframes(previous.keyframesName);
    record.applied = assignment;
    record.armed = true;
    syncBaseRule(record);
    render(record);
  }

  /** @param {ElementRecord} record */
  function clearApplied(record) {
    if (record.applied) releaseKeyframes(record.applied.keyframesName);
    record.applied = null;
    record.armed = false;
    syncBaseRule(record);
    render(record);
    // With nothing left on the element, drop the record: the snapshot has been written back, so
    // a future apply re-reads the host's own values rather than trusting a stale layer.
    if (!record.preview) records.delete(record.vmId);
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

    apply: function (payload) {
      if (!validateApplied(payload)) return { ok: false, error: "invalid-payload" };
      var record = recordFor(payload.vmId);
      if (!record) return { ok: false, error: "unknown-element" };
      setApplied(record, payload);
    },

    clear: function (payload) {
      var vmId = payload && payload.vmId;
      if (typeof vmId !== "string" || !VM_ID_RE.test(vmId)) return { ok: false, error: "invalid-payload" };
      if (!elements.has(vmId)) return { ok: false, error: "unknown-element" };
      var record = records.get(vmId);
      if (record) clearApplied(record);
    },

    "state:load": function (payload) {
      var list = payload && payload.assignments;
      if (!Array.isArray(list)) return { ok: false, error: "invalid-payload" };
      // Validate the whole batch before touching the page: a half-loaded state would leave the
      // frame showing something no version ever contained.
      for (var i = 0; i < list.length; i += 1) {
        if (!validateApplied(list[i])) return { ok: false, error: "invalid-payload" };
      }
      var open = /** @type {ElementRecord[]} */ ([]);
      records.forEach(function (record) {
        open.push(record);
      });
      for (var j = 0; j < open.length; j += 1) clearApplied(open[j]);
      var missing = false;
      for (var k = 0; k < list.length; k += 1) {
        var record = recordFor(list[k].vmId);
        if (!record) {
          missing = true;
          continue;
        }
        setApplied(record, list[k]);
      }
      if (missing) return { ok: false, error: "unknown-element" };
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
    // One stylesheet write per message at most, and inside the timed window so `ack.ms` is the
    // whole cost of the message.
    flushRuntime();
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
