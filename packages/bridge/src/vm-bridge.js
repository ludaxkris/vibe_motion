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
  /** Kept in sync with IN_VIEW_THRESHOLD in src/protocol.ts; the Phase 7 exporter uses it too. */
  var IN_VIEW_THRESHOLD = 0.2;

  // Kept byte-for-byte in sync with src/protocol.ts (test/render.test.ts asserts it).
  var VM_ID_RE = /^vm-[a-z0-9-]+$/;
  var KEYFRAMES_NAME_RE = /^vm-[a-z0-9-]+$/;
  var STYLE_KEY_RE = /^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/;

  var ID_ATTR = "data-vm-id";
  var ID_SELECTOR = "[data-vm-id]";
  var RUNTIME_STYLE_ID = "vm-runtime";
  var OVERLAY_ATTR = "data-vm-overlay";
  var HOVERED_ATTR = "data-vm-hovered";
  var SELECTED_ATTR = "data-vm-selected";
  var TEXT_PREVIEW_MAX = 80;
  var ACCENT = "#7c5cff";

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
    createOverlay();
    attachPageListeners();
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
   *   armed: boolean,
   *   replaying: boolean
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
      replaying: false,
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
   * Write one property the bridge takes ownership of, snapshotting whatever the host had there.
   *
   * @param {ElementRecord} record
   * @param {string} prop
   * @param {string} value
   * @param {boolean} important
   */
  function setOwned(record, prop, value, important) {
    snapshot(record, prop);
    record.owned.add(prop);
    var priority = important ? "important" : "";
    // Writing a declaration that is already exactly this invalidates style for nothing. On a
    // slider tick that leaves exactly one property written per frame (spec §6 budget).
    if (
      record.el.style.getPropertyValue(prop) === value &&
      record.el.style.getPropertyPriority(prop) === priority
    ) {
      return;
    }
    record.el.style.setProperty(prop, value, priority);
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
      wanted.add(desired[i][0]);
      setOwned(record, desired[i][0], desired[i][1], desired[i][2]);
    }
    var stale = /** @type {string[]} */ ([]);
    record.owned.forEach(function (prop) {
      if (!wanted.has(prop)) stale.push(prop);
    });
    for (var j = 0; j < stale.length; j += 1) restoreProp(record, stale[j]);
  }

  /** A preview is always armed; `replaying` is the one-shot arm that `replay` forces. */
  /** @param {ElementRecord} record */
  function isArmed(record) {
    return record.preview ? true : record.armed || record.replaying;
  }

  /**
   * The one place inline styles are written. `--vm-*` custom properties go on as soon as an
   * assignment exists (they are inert on their own); the whole `animation-*` group goes on
   * `!important` only while the trigger is armed, so our duration and delay never retime an
   * animation the host page was already running, and a host `prefers-reduced-motion` reset
   * cannot make the preview look dead (spec D3).
   *
   * @param {ElementRecord} record
   */
  function render(record) {
    var assignment = effective(record);
    if (!assignment) {
      restoreAll(record);
      return;
    }
    var armed = isArmed(record);
    // An `in-view` element that has not been scrolled to yet is *held on its first keyframe*
    // rather than left bare, so an entrance that starts at opacity 0 does not show, snap to
    // hidden and then fade in (spec D3, owner decision §9.3).
    var holding = !armed && assignment.trigger === "in-view";
    var desired = /** @type {Array<[string, string, boolean]>} */ ([]);
    var style = assignment.style;
    var key;
    for (key in style) {
      if (!Object.prototype.hasOwnProperty.call(style, key)) continue;
      if (key.indexOf("--") === 0) desired.push([key, style[key], false]);
    }
    if (armed || holding) {
      desired.push(["animation-name", assignment.keyframesName, true]);
      for (key in style) {
        if (!Object.prototype.hasOwnProperty.call(style, key)) continue;
        if (key.indexOf("--") !== 0) desired.push([key, style[key], true]);
      }
      // Pushed last, so these beat whatever the assignment's own style map said.
      if (holding) {
        desired.push(["animation-delay", "0s", true]);
        desired.push(["animation-fill-mode", "both", true]);
        desired.push(["animation-play-state", "paused", true]);
      } else {
        desired.push(["animation-play-state", "running", true]);
      }
    }
    writeDesired(record, desired);
  }

  /** Read by `forceStyleFlush` purely for its side effect on style resolution. */
  var styleFlushSink = "";

  /** @param {HTMLElement} el */
  function forceStyleFlush(el) {
    if (!window.getComputedStyle) return;
    var computed = window.getComputedStyle(el);
    // Reading the resolved value is what makes the browser settle style *now*, in this task, so
    // `none` and the real name are not coalesced into "nothing changed" and the animation
    // genuinely restarts.
    if (computed) styleFlushSink = computed.animationName;
  }

  /**
   * Restart the animation in one task: name to `none`, force a style flush, name back.
   *
   * @param {ElementRecord} record
   * @param {boolean} force  arm an unarmed trigger for this one play (`replay`)
   */
  function restart(record, force) {
    if (!effective(record)) return;
    if (!isArmed(record)) {
      if (!force) return;
      record.replaying = true;
    }
    rewind([record]);
  }

  /**
   * Give each record a brand new animation: `animation-name: none` for all of them, one style
   * flush for the batch, then render each.
   *
   * Every `in-view` arm-state transition has to go through here (spec D3). Changing anything but
   * `animation-name` updates a CSS animation *in place*, so an animation that has already
   * finished stays finished: toggling play-state, delay and fill-mode on it pauses it at its end
   * rather than rewinding it. That is what made `in-view` hold on its last keyframe and never
   * replay on re-entry. One flush per batch, not per element, keeps an observer callback with 60
   * entries to a single style recalculation.
   *
   * @param {ElementRecord[]} batch
   */
  function rewind(batch) {
    if (!batch.length) return;
    for (var i = 0; i < batch.length; i += 1) {
      if (effective(batch[i])) setOwned(batch[i], "animation-name", "none", true);
    }
    forceStyleFlush(batch[0].el);
    for (var j = 0; j < batch.length; j += 1) render(batch[j]);
  }

  /** @param {ElementRecord} record */
  function syncBaseRule(record) {
    var assignment = effective(record);
    setBaseRule(record.vmId, assignment ? assignment.baseStyles : "");
  }

  // ---------------------------------------------------------------------------------------
  // Triggers (spec D3)
  //
  // Triggers are armed by the bridge, never expressed as CSS selectors: a `:hover` rule of ours
  // would fight the host page's specificity, and writing only `animation-name` late would leave
  // our duration and delay retiming whatever the page was already animating.
  // ---------------------------------------------------------------------------------------

  /** The nearest tagged element under the pointer: what the outline and `element:hover` mean. */
  var hoveredVmId = /** @type {string | null} */ (null);
  /** Its tagged ancestors-or-self, nearest first: what hover *arming* follows (spec D3). */
  var hoverChain = /** @type {string[]} */ ([]);
  var inViewObserver = /** @type {IntersectionObserver | null} */ (null);

  /** One observer for every in-view assignment; created on first use (spec §6). */
  function getInViewObserver() {
    if (inViewObserver) return inViewObserver;
    // Read at call time: the constructor may be missing (old browser, jsdom) or installed late.
    var Ctor = window.IntersectionObserver;
    if (!Ctor) return null;
    inViewObserver = new Ctor(onIntersect, { threshold: IN_VIEW_THRESHOLD });
    return inViewObserver;
  }

  /** @param {IntersectionObserverEntry[]} entries */
  function onIntersect(entries) {
    var changed = /** @type {ElementRecord[]} */ ([]);
    for (var i = 0; i < entries.length; i += 1) {
      var vmId = entries[i].target.getAttribute(ID_ATTR);
      if (!vmId) continue;
      var record = records.get(vmId);
      if (!record || !record.applied || record.applied.trigger !== "in-view") continue;
      // The editor deliberately re-arms on every entry so the designer can scroll back and see
      // the animation again; the export plays once (spec §6a, owner decision §9.2).
      var next = !!entries[i].isIntersecting;
      if (record.armed === next) continue;
      record.armed = next;
      changed.push(record);
    }
    // Both directions, in one batch: arming has to start a new animation, and disarming has to
    // rewind to a new animation paused at t=0 rather than pausing the finished one (spec D3).
    rewind(changed);
  }

  /**
   * @param {ElementRecord} record
   * @param {import("./protocol").Trigger | null} previousTrigger
   */
  function updateArming(record, previousTrigger) {
    var assignment = record.applied;
    if (!assignment) return;
    if (previousTrigger === "in-view" && assignment.trigger !== "in-view" && inViewObserver) {
      inViewObserver.unobserve(record.el);
    }
    if (assignment.trigger === "in-view") {
      if (previousTrigger !== "in-view") {
        record.armed = false;
        var observer = getInViewObserver();
        if (observer) observer.observe(record.el);
      }
      return;
    }
    if (assignment.trigger === "hover") {
      record.armed = hoverChain.indexOf(record.vmId) >= 0;
      return;
    }
    record.armed = true;
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
    updateArming(record, previous ? previous.trigger : null);
    syncBaseRule(record);
    render(record);
    // Spec §3: a change of animation, trigger or base styles replays once; a param-only change
    // must not restart, or every slider tick would stutter.
    if (
      previous &&
      (previous.keyframesName !== assignment.keyframesName ||
        previous.trigger !== assignment.trigger ||
        previous.baseStyles !== assignment.baseStyles)
    ) {
      restart(record, false);
    }
  }

  /** @param {ElementRecord} record */
  function clearApplied(record) {
    if (record.applied) {
      releaseKeyframes(record.applied.keyframesName);
      if (record.applied.trigger === "in-view" && inViewObserver) inViewObserver.unobserve(record.el);
    }
    record.applied = null;
    record.armed = false;
    record.replaying = false;
    syncBaseRule(record);
    render(record);
    // With nothing left on the element, drop the record: the snapshot has been written back, so
    // a future apply re-reads the host's own values rather than trusting a stale layer.
    if (!record.preview) records.delete(record.vmId);
  }

  // ---------------------------------------------------------------------------------------
  // Transient preview (spec D4): one slot, never part of the draft, always played once.
  // ---------------------------------------------------------------------------------------

  var previewVmId = /** @type {string | null} */ (null);

  function dropPreview() {
    if (!previewVmId) return;
    var record = records.get(previewVmId);
    previewVmId = null;
    if (!record) return;
    if (record.preview) releaseKeyframes(record.preview.keyframesName);
    record.preview = null;
    syncBaseRule(record);
    render(record);
    if (!record.applied) records.delete(record.vmId);
  }

  // ---------------------------------------------------------------------------------------
  // Overlay (spec §4)
  //
  // One fixed-position container appended to <body>, excluded from hit-testing and from every
  // [data-vm-id] query, holding the hover outline and the selection ring with its label. The
  // ring is moved only by a `select` message — never by a click (spec D10) — because the shell
  // may refuse a selection change while the unsaved-changes guard is open.
  // ---------------------------------------------------------------------------------------

  var overlayRoot = /** @type {HTMLElement | null} */ (null);
  var hoverBox = /** @type {HTMLElement | null} */ (null);
  var selectBox = /** @type {HTMLElement | null} */ (null);
  var selectLabel = /** @type {HTMLElement | null} */ (null);
  var selectedVmId = /** @type {string | null} */ (null);
  var overlayFrame = 0;

  var BOX_BASE = "position:fixed;left:0;top:0;width:0;height:0;box-sizing:border-box;display:none;pointer-events:none;";

  function createOverlay() {
    var root = document.createElement("div");
    root.setAttribute(OVERLAY_ATTR, "");
    root.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;z-index:2147483647;";
    hoverBox = document.createElement("div");
    hoverBox.style.cssText = BOX_BASE + "border:1.5px dashed " + ACCENT + ";border-radius:2px;";
    selectBox = document.createElement("div");
    selectBox.style.cssText = BOX_BASE + "outline:2px solid " + ACCENT + ";outline-offset:6px;border-radius:2px;";
    selectLabel = document.createElement("div");
    selectLabel.style.cssText =
      "position:absolute;left:-6px;bottom:100%;margin:0 0 10px;padding:2px 6px;border-radius:3px;background:" +
      ACCENT +
      ";color:#fff;white-space:nowrap;font:500 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;";
    selectBox.appendChild(selectLabel);
    root.appendChild(hoverBox);
    root.appendChild(selectBox);
    document.body.appendChild(root);
    overlayRoot = root;
    // The whole page is a click target, so say so.
    document.documentElement.style.setProperty("cursor", "crosshair");
  }

  /**
   * @param {HTMLElement | null} box
   * @param {Element | undefined} el
   */
  function positionBox(box, el) {
    if (!box) return;
    if (!el) {
      box.style.display = "none";
      return;
    }
    var rect = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
  }

  function syncOverlay() {
    positionBox(hoverBox, hoveredVmId ? elements.get(hoveredVmId) : undefined);
    positionBox(selectBox, selectedVmId ? elements.get(selectedVmId) : undefined);
  }

  function scheduleOverlaySync() {
    if (overlayFrame) return;
    // Read at call time so a page without rAF still repositions, just synchronously.
    if (!window.requestAnimationFrame) {
      syncOverlay();
      return;
    }
    overlayFrame = window.requestAnimationFrame(function () {
      overlayFrame = 0;
      syncOverlay();
    });
  }

  /**
   * @param {string} vmId
   * @returns {import("./protocol").ElementInfo | null}
   */
  function elementInfo(vmId) {
    var el = elements.get(vmId);
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var computed = window.getComputedStyle ? window.getComputedStyle(el) : null;
    var text = (el.textContent || "").replace(/\s+/g, " ").trim();
    var scrollX = window.pageXOffset || 0;
    var scrollY = window.pageYOffset || 0;
    var order = orders.get(vmId);
    return {
      vmId: vmId,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      textPreview: text.length > TEXT_PREVIEW_MAX ? text.slice(0, TEXT_PREVIEW_MAX) : text,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      pageRect: { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height },
      order: order === undefined ? -1 : order,
      visible:
        rect.width > 0 &&
        rect.height > 0 &&
        (!computed || (computed.visibility !== "hidden" && computed.display !== "none")),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Page listeners
  // ---------------------------------------------------------------------------------------

  /**
   * Every tagged ancestor-or-self of `target`, nearest first. Overlay nodes never match: they are
   * not tagged, and they are not part of the page the designer is editing.
   *
   * @param {EventTarget | null} target
   * @returns {string[]}
   */
  function taggedChain(target) {
    var chain = /** @type {string[]} */ ([]);
    var node = /** @type {Node | null} */ (/** @type {unknown} */ (target));
    while (node && node.nodeType !== 1) node = node.parentNode;
    var el = /** @type {Element | null} */ (node);
    while (el) {
      if (el === overlayRoot) return [];
      var vmId = el.getAttribute(ID_ATTR);
      if (vmId && elements.has(vmId) && chain.indexOf(vmId) < 0) chain.push(vmId);
      el = el.parentElement;
    }
    return chain;
  }

  /**
   * @param {EventTarget | null} target
   * @returns {string | null}
   */
  function nearestTaggedId(target) {
    var chain = taggedChain(target);
    return chain.length ? chain[0] : null;
  }

  /**
   * Hover has two different scopes on purpose (spec D3).
   *
   * *Arming* follows the whole chain of tagged ancestors, because the page still considers a card
   * hovered when the pointer is over a button inside it, and a `:hover` rule in the Phase 7 export
   * would still match. Following only the nearest tagged element disarmed the card the moment the
   * pointer reached the button, and with a transform keyframe that oscillated at frame rate.
   *
   * *The outline and `element:hover`* stay nearest-only: the designer is pointing at one thing.
   *
   * @param {EventTarget | null} target
   */
  function setHovered(target) {
    var chain = taggedChain(target);
    var nearest = chain.length ? chain[0] : null;
    var i;
    for (i = 0; i < hoverChain.length; i += 1) {
      if (chain.indexOf(hoverChain[i]) < 0) armHover(hoverChain[i], false);
    }
    for (i = 0; i < chain.length; i += 1) {
      if (hoverChain.indexOf(chain[i]) < 0) armHover(chain[i], true);
    }
    hoverChain = chain;

    if (nearest === hoveredVmId) return;
    hoveredVmId = nearest;
    if (overlayRoot) {
      if (nearest) overlayRoot.setAttribute(HOVERED_ATTR, nearest);
      else overlayRoot.removeAttribute(HOVERED_ATTR);
    }
    positionBox(hoverBox, nearest ? elements.get(nearest) : undefined);
    // Only on a change: a message per mouse move would flood the channel (spec §6).
    post("element:hover", nearest ? elementInfo(nearest) : { vmId: null });
  }

  /**
   * @param {string} vmId
   * @param {boolean} armed
   */
  function armHover(vmId, armed) {
    var record = records.get(vmId);
    if (!record || !record.applied || record.applied.trigger !== "hover") return;
    if (record.armed === armed) return;
    record.armed = armed;
    render(record);
  }

  /**
   * End a forced `replay`, but only for the element's own animation.
   *
   * `animationend` bubbles, so without the target check a host spinner or marquee finishing
   * anywhere inside a tagged element would strip the whole animation group mid-play; without the
   * name check, a second animation on the element itself would do the same.
   *
   * @param {AnimationEvent} event
   */
  function onAnimationBoundary(event) {
    var el = /** @type {Element | null} */ (/** @type {unknown} */ (event.target));
    if (!el || !el.getAttribute) return;
    var vmId = el.getAttribute(ID_ATTR);
    if (!vmId) return;
    var record = records.get(vmId);
    if (!record || record.el !== el) return;
    if (selectedVmId === vmId && event.type !== "animationiteration") scheduleOverlaySync();
    if (!record.replaying) return;
    var assignment = effective(record);
    if (!assignment || event.animationName !== assignment.keyframesName) return;
    record.replaying = false;
    // An in-view element that is still off-screen has to go back to a *new* animation paused at
    // its first keyframe, not to the one that just finished (spec D3).
    if (record.applied && record.applied.trigger === "in-view") rewind([record]);
    else render(record);
  }

  function attachPageListeners() {
    // Capture phase and delegated: one pair of handlers drives hover arming, the hover outline
    // and the `element:hover` message, and the host page's own handlers cannot stop them.
    document.addEventListener(
      "pointerover",
      function (event) {
        setHovered(event.target);
      },
      true,
    );
    document.addEventListener(
      "pointerout",
      function (event) {
        // `pointerout` fires before `pointerover` when moving between elements, so resolving the
        // related target here means one state change per move, not two.
        setHovered(event.relatedTarget);
      },
      true,
    );
    document.addEventListener("animationend", onAnimationBoundary, true);
    // A looping animation never fires `animationend`, so the first iteration boundary is what
    // ends a forced replay of one; and an animation we replace mid-flight fires `animationcancel`.
    document.addEventListener("animationiteration", onAnimationBoundary, true);
    document.addEventListener("animationcancel", onAnimationBoundary, true);
    // Capture phase and passive: scroll does not bubble out of a nested scroller, and the
    // overlay must never be the reason a scroll janks.
    document.addEventListener("scroll", scheduleOverlaySync, { capture: true, passive: true });
    window.addEventListener("resize", scheduleOverlaySync, false);
  }

  /**
   * @param {string | null} vmId
   * @param {string} label
   */
  function setSelected(vmId, label) {
    selectedVmId = vmId;
    if (overlayRoot) {
      if (vmId) overlayRoot.setAttribute(SELECTED_ATTR, vmId);
      else overlayRoot.removeAttribute(SELECTED_ATTR);
    }
    if (selectLabel) selectLabel.textContent = label || "";
    positionBox(selectBox, vmId ? elements.get(vmId) : undefined);
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
      // Spec §3: `state:load` clears every assignment *and* the preview, then applies the list.
      dropPreview();
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

    replay: function (payload) {
      var vmId = payload ? payload.vmId : null;
      if (vmId === null || vmId === undefined) {
        var all = /** @type {ElementRecord[]} */ ([]);
        records.forEach(function (record) {
          all.push(record);
        });
        for (var i = 0; i < all.length; i += 1) restart(all[i], true);
        return;
      }
      if (typeof vmId !== "string" || !VM_ID_RE.test(vmId)) return { ok: false, error: "invalid-payload" };
      if (!elements.has(vmId)) return { ok: false, error: "unknown-element" };
      var record = records.get(vmId);
      if (record) restart(record, true);
    },

    preview: function (payload) {
      if (!validateApplied(payload)) return { ok: false, error: "invalid-payload" };
      var record = recordFor(payload.vmId);
      if (!record) return { ok: false, error: "unknown-element" };
      if (previewVmId && previewVmId !== payload.vmId) dropPreview();
      var previous = record.preview;
      acquireKeyframes(payload.keyframesName, payload.keyframesCss);
      if (previous) releaseKeyframes(previous.keyframesName);
      record.preview = payload;
      previewVmId = payload.vmId;
      syncBaseRule(record);
      render(record);
      restart(record, false);
    },

    "preview:clear": function () {
      dropPreview();
    },

    select: function (payload) {
      var vmId = payload ? payload.vmId : null;
      if (vmId === null || vmId === undefined) {
        setSelected(null, "");
        return;
      }
      if (typeof vmId !== "string" || !VM_ID_RE.test(vmId)) return { ok: false, error: "invalid-payload" };
      var el = elements.get(vmId);
      if (!el) return { ok: false, error: "unknown-element" };
      var label = typeof payload.label === "string" && payload.label ? payload.label : el.tagName.toLowerCase();
      setSelected(vmId, label);
      if (payload.scrollIntoView && typeof el.scrollIntoView === "function") {
        try {
          el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        } catch (error) {
          /* Not every engine takes the options object; the ring is drawn either way. */
        }
      }
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
  // not, and either one navigating away would lose the designer's unsaved work. Registered at
  // evaluation time rather than at init, so nothing can navigate in the gap before DOM ready.
  document.addEventListener(
    "click",
    function (event) {
      event.preventDefault();
      event.stopPropagation();
      ensureInit();
      var vmId = nearestTaggedId(event.target);
      if (!vmId) {
        post("element:deselect", { reason: "background" });
        return;
      }
      // A request, not a move: the ring follows only when the shell answers with `select`,
      // because it may open the unsaved-changes guard first (spec D10).
      var info = elementInfo(vmId);
      if (info) post("element:select", info);
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

  document.addEventListener(
    "keydown",
    function (event) {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      post("element:deselect", { reason: "escape" });
    },
    true,
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceReady, { once: true });
  } else {
    announceReady();
  }
})();
