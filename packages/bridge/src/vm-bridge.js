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
  var BRIDGE_VERSION = "1.1.2";
  var MESSAGE_SOURCE = "vibe-motion";
  var PROTOCOL_VERSION = 1;
  /** Kept in sync with IN_VIEW_THRESHOLD in src/protocol.ts; the Phase 7 exporter uses it too. */
  var IN_VIEW_THRESHOLD = 0.2;

  // Kept byte-for-byte in sync with src/protocol.ts (test/render.test.ts asserts it).
  var VM_ID_RE = /^vm-[a-z0-9-]+$/;
  var KEYFRAMES_NAME_RE = /^vm-[a-z0-9-]+$/;
  var STYLE_KEY_RE = /^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/;
  /** `elements:query` default and ceiling for `limit`; same values as src/protocol.ts. */
  var ELEMENTS_QUERY_LIMIT = 200;
  var ELEMENTS_QUERY_MAX = 500;

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

  /**
   * `WEB_ORIGIN` is injected as-is, and a value with a trailing slash or a path would still work
   * as an outbound `targetOrigin` (the browser parses it) while never matching an inbound
   * `event.origin`: a frame that loads, handshakes, and then silently ignores everything. Parse
   * it once here so that failure mode cannot exist.
   *
   * @param {string | null | undefined} value
   * @returns {string | null}
   */
  function normaliseOrigin(value) {
    if (!value) return null;
    try {
      var origin = new URL(value).origin;
      return origin && origin !== "null" ? origin : null;
    } catch (error) {
      return null;
    }
  }

  // Read at evaluation time: `document.currentScript` is only meaningful while the script runs.
  var ownScript = document.currentScript;
  var parentOrigin = normaliseOrigin(ownScript && ownScript.dataset ? ownScript.dataset.vmParentOrigin : null);

  /**
   * No shell to talk to means this is not a preview: someone opened the cloned page directly.
   * It then stays an ordinary page (spec D7 / §2) — no overlay, no crosshair, and links and
   * forms still work.
   */
  var hasShell = !!parentOrigin && window.parent !== window;

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
    if (!hasShell || !parentOrigin) return;
    try {
      window.parent.postMessage({ source: MESSAGE_SOURCE, type: type, payload: payload }, parentOrigin);
    } catch (error) {
      /* A blocked postMessage must not break the page the designer is looking at. */
    }
  }

  /**
   * @param {unknown} x
   * @returns {x is number}
   */
  function isFiniteNumber(x) {
    return typeof x === "number" && isFinite(x);
  }

  /**
   * `role` is a space-separated fallback list (`role="button link"`), so match by token.
   *
   * @param {Element} el
   */
  function hasButtonRole(el) {
    var role = el.getAttribute("role");
    if (!role) return false;
    var tokens = role.toLowerCase().split(/\s+/);
    return tokens.indexOf("button") !== -1;
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
    if (initialised || !hasShell || !document.body) return;
    initialised = true;
    buildElementMap();
    createOverlay();
    attachPageListeners();
  }

  /**
   * Answer the handshake, if we can. Never answers before the element map exists, or a `hello`
   * from a shell that mounted early would report `elementCount: 0`.
   *
   * @returns {boolean} whether a `ready` was posted
   */
  function announceReady() {
    ensureInit();
    if (!initialised) return false;
    post("ready", {
      elementCount: elements.size,
      bridgeVersion: BRIDGE_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    });
    return true;
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
  var runtimeSheet = /** @type {CSSStyleSheet | null} */ (null);
  /** keyframesName -> its live rule, the CSS it came from, and how many assignments want it. */
  var keyframeRefs = /** @type {Map<string, { rule: CSSRule, css: string, count: number }>} */ (new Map());
  /** vmId -> the live base-styles rule and the declarations currently in it. */
  var baseRules = /** @type {Map<string, { rule: CSSStyleRule, css: string }>} */ (new Map());

  /** The crosshair, as a rule rather than an inline style on <html> (N4). */
  var CURSOR_RULE =
    ':root[data-vm-mode="edit"], :root[data-vm-mode="edit"] * { cursor: crosshair !important; }';

  /**
   * Our own `<style id="vm-runtime">`, never one the page already had: a page previously exported
   * by Vibe Motion carries that id with live host CSS in it, and adopting it would hand us
   * someone else's rules to delete.
   */
  function ensureRuntimeSheet() {
    if (runtimeStyle && runtimeStyle.parentNode && runtimeStyle.sheet) return runtimeStyle.sheet;
    // Having had one before means it was detached. The rules we are holding belong to a sheet
    // that no longer applies, so they are rebuilt below rather than left as dead handles that
    // `dropRule` would silently no-op on.
    var rebuilding = !!runtimeStyle;
    var created = document.createElement("style");
    created.id = RUNTIME_STYLE_ID;
    (document.head || document.documentElement).appendChild(created);
    runtimeStyle = created;
    runtimeSheet = created.sheet;
    if (runtimeSheet) {
      try {
        runtimeSheet.insertRule(CURSOR_RULE, 0);
      } catch (error) {
        /* An engine that will not take the rule simply shows the page's own cursors. */
      }
    }
    if (rebuilding) rebuildRules();
    return runtimeSheet;
  }

  /** Re-insert everything the reference counts say should be live, into the new sheet. */
  function rebuildRules() {
    if (!runtimeSheet) return;
    var sheet = /** @type {CSSStyleSheet} */ (runtimeSheet);
    keyframeRefs.forEach(function (entry, name) {
      try {
        entry.rule = sheet.cssRules[sheet.insertRule(entry.css, sheet.cssRules.length)];
      } catch (error) {
        // Keeping the entry would make `acquireKeyframes` answer `true` for a name that is not
        // in any sheet, so an apply would be acked OK while the animation resolved to nothing.
        keyframeRefs.delete(name);
      }
    });
    baseRules.forEach(function (entry, vmId) {
      try {
        var rule = /** @type {CSSStyleRule} */ (
          sheet.cssRules[sheet.insertRule("[" + ID_ATTR + '="' + vmId + '"] {}', sheet.cssRules.length)]
        );
        rule.style.cssText = entry.css;
        entry.rule = rule;
      } catch (error) {
        // Same: a stale handle here would make `setBaseRule` edit a rule nothing renders.
        baseRules.delete(vmId);
      }
    });
  }

  /**
   * @param {CSSRule} rule
   * @returns {number}
   */
  function ruleIndex(rule) {
    if (!runtimeSheet) return -1;
    return Array.prototype.indexOf.call(runtimeSheet.cssRules, rule);
  }

  /** @param {CSSRule} rule */
  function dropRule(rule) {
    var index = ruleIndex(rule);
    if (index >= 0 && runtimeSheet) runtimeSheet.deleteRule(index);
  }

  /**
   * Add one `@keyframes` block, or take another reference on one already there.
   *
   * The CSS never goes through string concatenation: it is parsed by the engine and then checked
   * as a *rule*, so a `keyframesCss` that is not exactly one `@keyframes` block with the promised
   * name cannot land. That is the difference between checking a string prefix and knowing what
   * the browser actually parsed, and it closes the injection route that Phase 5's generated
   * animations would otherwise open.
   *
   * @param {string} name
   * @param {string} css
   * @returns {boolean} false when the payload should be rejected
   */
  function acquireKeyframes(name, css) {
    var entry = keyframeRefs.get(name);
    if (entry) {
      // A name is a pinned catalog version, so the same name with different bodies is a bug in
      // the sender, not something to resolve last-writer-wins.
      if (entry.css !== css) return false;
      entry.count += 1;
      return true;
    }
    var sheet = ensureRuntimeSheet();
    if (!sheet) return false;
    var rule;
    try {
      rule = sheet.cssRules[sheet.insertRule(css, sheet.cssRules.length)];
    } catch (error) {
      return false;
    }
    var keyframesType = window.CSSRule ? window.CSSRule.KEYFRAMES_RULE : 7;
    if (rule.type !== keyframesType || /** @type {CSSKeyframesRule} */ (rule).name !== name) {
      dropRule(rule);
      return false;
    }
    keyframeRefs.set(name, { rule: rule, css: css, count: 1 });
    return true;
  }

  /** @param {string | null | undefined} name */
  function releaseKeyframes(name) {
    if (!name) return;
    var entry = keyframeRefs.get(name);
    if (!entry) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    keyframeRefs.delete(name);
    dropRule(entry.rule);
  }

  /**
   * One `[data-vm-id="…"] { … }` rule per assignment with base styles.
   *
   * The declarations are set with `style.cssText`, which parses a declaration list: a stray `}`
   * in there ends up discarded rather than closing our rule and opening one of the sender's.
   *
   * @param {string} vmId
   * @param {string} css
   */
  function setBaseRule(vmId, css) {
    var entry = baseRules.get(vmId);
    var next = css || "";
    if (!next) {
      if (!entry) return;
      baseRules.delete(vmId);
      dropRule(entry.rule);
      return;
    }
    if (entry) {
      if (entry.css === next) return;
      entry.css = next;
      entry.rule.style.cssText = next;
      return;
    }
    var sheet = ensureRuntimeSheet();
    if (!sheet) return;
    try {
      var rule = /** @type {CSSStyleRule} */ (
        sheet.cssRules[sheet.insertRule("[" + ID_ATTR + '="' + vmId + '"] {}', sheet.cssRules.length)]
      );
      rule.style.cssText = next;
      baseRules.set(vmId, { rule: rule, css: next });
    } catch (error) {
      /* A selector the engine will not take means no base styles, not a broken frame. */
    }
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

  /**
   * Every `animation-*` longhand at its initial value, except `animation-name` and
   * `animation-play-state`, which the bridge sets explicitly on every render.
   */
  var ANIMATION_INITIALS = [
    ["animation-duration", "0s"],
    ["animation-timing-function", "ease"],
    ["animation-delay", "0s"],
    ["animation-iteration-count", "1"],
    ["animation-direction", "normal"],
    ["animation-fill-mode", "none"],
  ];

  var timelineSupported = /** @type {boolean | null} */ (null);

  function supportsTimeline() {
    if (timelineSupported === null) {
      timelineSupported = !!(
        window.CSS &&
        window.CSS.supports &&
        window.CSS.supports("animation-timeline", "auto")
      );
    }
    return timelineSupported;
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
      // The group is only coherent if it is *whole*: any longhand the style map leaves out is
      // written at its initial value, so a host `animation: spin 2s linear infinite` cannot
      // retime our animation or leave it looping forever (spec D3). Pushed before the style map,
      // which therefore wins for everything it does carry.
      for (var i = 0; i < ANIMATION_INITIALS.length; i += 1) {
        var initial = ANIMATION_INITIALS[i];
        if (!Object.prototype.hasOwnProperty.call(style, initial[0])) desired.push([initial[0], initial[1], true]);
      }
      if (supportsTimeline() && !Object.prototype.hasOwnProperty.call(style, "animation-timeline")) {
        desired.push(["animation-timeline", "auto", true]);
      }
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

  /**
   * The first element of the batch that is really in the document.
   *
   * @param {ElementRecord[]} batch
   * @returns {HTMLElement}
   */
  function flushAnchor(batch) {
    for (var i = 0; i < batch.length; i += 1) {
      var el = batch[i].el;
      var connected = typeof el.isConnected === "boolean" ? el.isConnected : document.contains(el);
      if (connected) return el;
    }
    return document.documentElement;
  }

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
   * Arm a record for a forced replay without touching the DOM, so a page-wide `replay` can
   * collect every element first and rewind them in one batch.
   *
   * @param {ElementRecord} record
   * @returns {boolean} whether the record takes part
   */
  function armForReplay(record) {
    if (!effective(record)) return false;
    if (!isArmed(record)) record.replaying = true;
    return true;
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
    // The flush resolves style for the whole document, so one is enough for the batch — but it
    // has to be anchored on a node that is actually in the document. Resolving style on a
    // detached node is a no-op in Blink, which would silently skip the flush for everyone and
    // leave every `none` -> name pair to coalesce into nothing. The root is not a usable anchor
    // either: reading its computed style does not update the animations of its descendants.
    forceStyleFlush(flushAnchor(batch));
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
  /** Whether the root had no area at the last callback: what `recoverFromEmptyRoot` watches for. */
  var inViewRootEmpty = false;

  /** One observer for every in-view assignment; created on first use (spec §6). */
  function getInViewObserver() {
    if (inViewObserver) return inViewObserver;
    // Read at call time: the constructor may be missing (old browser, jsdom) or installed late.
    var Ctor = window.IntersectionObserver;
    if (!Ctor) return null;
    // Two thresholds: 0, so an element that can never reach the real one is still reported the
    // moment it intersects at all, and the real one for everything else. `isOnScreen` decides.
    inViewObserver = new Ctor(onIntersect, { threshold: [0, IN_VIEW_THRESHOLD] });
    return inViewObserver;
  }

  /**
   * The largest fraction of `size` that can ever be inside a root of `rootSize`, per axis.
   *
   * @param {number} size
   * @param {number} rootSize
   * @returns {number}
   */
  function reachableFraction(size, rootSize) {
    // `rootSize / 0` is Infinity and `0 / 0` is NaN; `1` is the answer that holds an element rather
    // than playing it. Neither guard answers for a conforming browser: a zero-*area* target that
    // intersects is reported at `intersectionRatio: 1`, so such an entry leaves at the ratio line
    // above, and an empty root is rejected before this is reached at all.
    if (!(size > 0) || !(rootSize > 0)) return 1;
    return Math.min(1, rootSize / size);
  }

  /**
   * Whether this entry counts as "in view" — the same condition the export runtime uses
   * (`src/vibe-motion-export.js`), so a designer sees in the preview what the export will do
   * (spec §6a; the two copies must not drift).
   *
   * `intersectionRatio` is intersected area over the element's *whole* area, so an element bigger
   * than the root can never reach 1 — and one big enough can never reach the threshold at all,
   * which would hold it on its first keyframe for the whole session. The best ratio it could ever
   * reach is the fraction that fits, in each axis, multiplied: when even that is under the
   * threshold the ratio test is unreachable and the element counts as in view as soon as it
   * intersects. `<=`, not `<`: an element whose best possible ratio is exactly the threshold can
   * only reach it perfectly aligned, which is float rounding rather than being on screen.
   *
   * An **area**, not a height: a 4000px track in a horizontal scroller reaches 0.16 with a
   * perfectly ordinary height, and a 1280x1200 element is short on neither axis alone.
   *
   * An **empty** root — zero on either axis — shows nothing, so nothing in it is in view, whatever
   * ratio the browser reports (a zero-area target that intersects is reported at ratio 1). That is
   * tested before the ratio, and on the whole root rather than per axis: a root collapsed on one
   * axis leaves the element's own unreachable axis carrying the product under the threshold, which
   * would play the biggest elements on the page where nobody can see them and leave them armed, so
   * they never play when the root comes back.
   *
   * `rootBounds` is null for an implicit root inside a cross-origin iframe, which is every bridge
   * there is, so the caller's fallback is the normal path here rather than the edge case it is in
   * an export; reading `.width` off null would throw inside the observer callback and leave the
   * element held for ever.
   *
   * Still not covered, and logged as DT-184 for preview and export alike: a clip container
   * narrower than the root, which bounds the intersection without appearing in `rootBounds`.
   *
   * @param {IntersectionObserverEntry} entry
   * @param {number} fallbackWidth   the root's width when the entry reports no `rootBounds`
   * @param {number} fallbackHeight  the root's height when the entry reports no `rootBounds`
   * @returns {boolean}
   */
  function isOnScreen(entry, fallbackWidth, fallbackHeight) {
    if (!entry.isIntersecting) return false;
    var rootBounds = entry.rootBounds;
    var rootWidth = rootBounds ? rootBounds.width : fallbackWidth;
    var rootHeight = rootBounds ? rootBounds.height : fallbackHeight;
    if (!(rootWidth > 0) || !(rootHeight > 0)) return false;
    if (entry.intersectionRatio >= IN_VIEW_THRESHOLD) return true;
    var box = entry.boundingClientRect;
    var reachable = reachableFraction(box.width, rootWidth) * reachableFraction(box.height, rootHeight);
    return reachable <= IN_VIEW_THRESHOLD;
  }

  /**
   * The root box an entry with no `rootBounds` is measured against: the frame's own viewport.
   *
   * In a standards-mode document `documentElement.clientWidth` / `clientHeight` is the viewport
   * *without* the scrollbar gutter, which is exactly what the implicit root intersects against and
   * what `innerWidth` / `innerHeight` overstate by the width of the gutter. In quirks mode
   * (`BackCompat`) the same two properties are the **document** box instead — a clone whose origin
   * page had no doctype reports 6000px for a 600px frame — and measuring against that makes every
   * big element look reachable and holds it for ever, which is the whole of DT-095. A clone gets
   * whatever doctype the origin had and the clone pipeline inserts none, so the mode is read, not
   * assumed. `elements:list.viewport` is a different question with a different answer (`window`,
   * spec §3), which is why this lives here rather than in one shared "the viewport" helper.
   *
   * @returns {{ width: number, height: number }}
   */
  function fallbackRootBox() {
    var root = document.documentElement;
    if (!root || document.compatMode !== "CSS1Compat") {
      return { width: window.innerWidth, height: window.innerHeight };
    }
    return { width: root.clientWidth, height: root.clientHeight };
  }

  /** @param {IntersectionObserverEntry[]} entries */
  function onIntersect(entries) {
    // Read once for the whole batch, before anything writes, so every entry is judged against one
    // root and the per-entry path stays two property reads short.
    var rootBox = fallbackRootBox();
    var rootWidth = rootBox.width;
    var rootHeight = rootBox.height;
    // Raised here, and lowered *only* by `recoverFromEmptyRoot`. While the root is empty every
    // element is held, and a root that grows back crosses no threshold for an unreachable one, so
    // nothing would arrive to release it (spec §6a) — but the elements that were *below* the
    // collapsed root do cross one, and their entries reach this callback before the `resize` event
    // does. An `else` here would let them lower the latch and no-op the recovery the stranded
    // element depends on, for every page with more than one in-view assignment.
    if (!(rootWidth > 0) || !(rootHeight > 0)) inViewRootEmpty = true;

    var changed = /** @type {ElementRecord[]} */ ([]);
    for (var i = 0; i < entries.length; i += 1) {
      var vmId = entries[i].target.getAttribute(ID_ATTR);
      if (!vmId) continue;
      var record = records.get(vmId);
      if (!record || !record.applied || record.applied.trigger !== "in-view") continue;
      // Armed exactly while the firing condition holds, so disarming is its negation: an element
      // that can reach the threshold is held again below it, and one that cannot is held again
      // only when it stops intersecting at all.
      //
      // The editor deliberately re-arms on every entry so the designer can scroll back and see
      // the animation again; the export plays once (spec §6a, owner decision §9.2).
      var next = isOnScreen(entries[i], rootWidth, rootHeight);
      if (record.armed === next) continue;
      record.armed = next;
      // A preview is transient and belongs to the catalog card the pointer is on, not to the
      // scroll position (spec D4). Record the new arm state so `preview:clear` renders the right
      // thing, but leave what is on screen alone.
      if (record.preview) continue;
      changed.push(record);
    }
    // Both directions, in one batch: arming has to start a new animation, and disarming has to
    // rewind to a new animation paused at t=0 rather than pausing the finished one (spec D3).
    rewind(changed);
  }

  /**
   * Re-observe every in-view element once the root stops being empty.
   *
   * A root with no area holds everything (see `isOnScreen`), and a root that grows back does not
   * on its own produce an entry for the elements that were held: an unreachable one goes from
   * ratio 0 to a ratio still under the threshold, crossing none of `[0, T]`, and `isIntersecting`
   * was already true while the root was flat, so there is nothing for the browser to report.
   * `unobserve` + `observe` queues a fresh initial observation, and the normal rule decides on it.
   *
   * Called from the `resize` listener the overlay already uses, so there is no new listener, no
   * timer and no per-frame work; when the root has never been empty it is one boolean test and not
   * even a layout read. It cannot loop: only a callback sets the flag, and observing fires no
   * resize.
   */
  function recoverFromEmptyRoot() {
    if (!inViewRootEmpty || !inViewObserver) return;
    // The same root the callback judges entries against, so the two can never disagree about what
    // "empty" means. Still empty: keep the latch and wait for the resize that opens it.
    var rootBox = fallbackRootBox();
    if (!(rootBox.width > 0) || !(rootBox.height > 0)) return;
    inViewRootEmpty = false;
    var observer = inViewObserver;
    records.forEach(function (record) {
      if (!record.applied || record.applied.trigger !== "in-view") return;
      observer.unobserve(record.el);
      observer.observe(record.el);
    });
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
    // the reference count to zero and touches the stylesheet for nothing.
    if (!acquireKeyframes(assignment.keyframesName, assignment.keyframesCss)) return false;
    if (previous) releaseKeyframes(previous.keyframesName);
    record.applied = assignment;
    updateArming(record, previous ? previous.trigger : null);
    syncBaseRule(record);
    // Spec §3: a change of animation, trigger or base styles replays once; a param-only change
    // must not restart, or every slider tick would stutter. Spec D6: an apply that arrives
    // during a preview updates the layer underneath and leaves the preview playing.
    var changedAnimation =
      !!previous &&
      !record.preview &&
      (previous.keyframesName !== assignment.keyframesName ||
        previous.trigger !== assignment.trigger ||
        previous.baseStyles !== assignment.baseStyles);
    if (changedAnimation && isArmed(record)) restart(record, false);
    else render(record);
    return true;
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
    // Back to whatever the trigger says now, including any arm transitions the preview sat out.
    if (record.applied && record.applied.trigger === "in-view") rewind([record]);
    else render(record);
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
  /**
   * Per overlay box: which element it is drawn for, and that element's resting *correction* —
   * `getBoundingClientRect() - layoutBox()` as of the last measurement taken while none of our
   * animations was running on it. See `positionBox`.
   *
   * @returns {{ vmId: string | null, dx: number, dy: number, dw: number, dh: number }}
   */
  function newBoxState() {
    return { vmId: null, dx: 0, dy: 0, dw: 0, dh: 0 };
  }
  var hoverBoxState = newBoxState();
  var selectBoxState = newBoxState();
  var overlayFrame = 0;

  var BOX_BASE = "position:fixed;left:0;top:0;width:0;height:0;box-sizing:border-box;display:none;pointer-events:none;";

  function createOverlay() {
    var root = document.createElement("div");
    root.setAttribute(OVERLAY_ATTR, "");
    root.style.cssText =
      "position:fixed;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;pointer-events:none;z-index:2147483647;";
    hoverBox = document.createElement("div");
    hoverBox.setAttribute("data-vm-overlay-hover", "");
    hoverBox.style.cssText = BOX_BASE + "border:1.5px dashed " + ACCENT + ";border-radius:2px;";
    selectBox = document.createElement("div");
    selectBox.setAttribute("data-vm-overlay-ring", "");
    selectBox.style.cssText = BOX_BASE + "outline:2px solid " + ACCENT + ";outline-offset:6px;border-radius:2px;";
    selectLabel = document.createElement("div");
    selectLabel.setAttribute("data-vm-overlay-label", "");
    selectLabel.style.cssText =
      "position:absolute;left:-6px;bottom:100%;margin:0 0 10px;padding:2px 6px;border-radius:3px;background:" +
      ACCENT +
      ";color:#fff;white-space:nowrap;font:500 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;";
    selectBox.appendChild(selectLabel);
    root.appendChild(hoverBox);
    root.appendChild(selectBox);
    document.body.appendChild(root);
    overlayRoot = root;
    // The whole page is a click target, so say so. As an attribute plus a rule in our own sheet,
    // not an inline style: inline would clobber a host `cursor` with no way back, and an
    // inherited value loses to the UA's `cursor: pointer` on exactly the links and buttons the
    // designer clicks most. Phase 6's reserved `mode: "view"` is then one attribute flip.
    ensureRuntimeSheet();
    document.documentElement.setAttribute("data-vm-mode", "edit");
  }

  /**
   * Is one of *our* animations moving this element right now?
   *
   * `getAnimations()` also returns animations that have finished but still
   * fill (`fill-mode: both`, which most entrance animations use), and those
   * leave the element at its resting box — so play state is the question, not
   * existence. A host animation does not count: the ring has to keep following
   * an element the page itself is moving.
   *
   * @param {string} vmId
   */
  function isMidOwnAnimation(vmId) {
    var record = records.get(vmId);
    if (!record) return false;
    var assignment = effective(record);
    if (!assignment) return false;
    var el = record.el;
    if (typeof el.getAnimations !== "function") return false;
    var running = el.getAnimations();
    for (var i = 0; i < running.length; i += 1) {
      var animation = /** @type {CSSAnimation} */ (running[i]);
      if (!animation || animation.animationName !== assignment.keyframesName) continue;
      // Only "running". A *paused* one — an `in-view` element held at its
      // first keyframe — is sitting still at the box the designer can see, so
      // the ring should mark that; and freezing on it would stop the ring
      // following a scroll for as long as the element stayed off-screen.
      if (animation.playState === "running") return true;
    }
    return false;
  }

  /**
   * The element's border box in viewport coordinates, computed from *layout* instead of from
   * `getBoundingClientRect()`.
   *
   * `offsetLeft` / `offsetTop` / `offsetWidth` / `offsetHeight` are layout values: a `transform`
   * on the element or on any ancestor never reaches them, which is the whole point here.
   * `offsetLeft`/`offsetTop` are measured from the offsetParent's *padding* edge and are blind to
   * scrolling, so the walk adds each offsetParent's border (`clientLeft`/`clientTop`) and then
   * subtracts every ancestor's scroll offset — `documentElement`'s included, which is the page
   * scroll in standards mode.
   *
   * `offsetParent` is null on `<body>` and on a `position: fixed` box, so where the first walk
   * stops says which of the two the accumulated coordinates are relative to: the document (stop
   * at `<body>`, so subtract every scroll up to the root) or the viewport (stop at a fixed box,
   * so subtract only the scrolls inside it).
   *
   * @param {Element} element
   * @returns {{ left: number, top: number, width: number, height: number }}
   */
  function layoutBox(element) {
    var el = /** @type {HTMLElement} */ (element);
    var left = 0;
    var top = 0;
    var node = el;
    for (;;) {
      left += node.offsetLeft || 0;
      top += node.offsetTop || 0;
      var parent = /** @type {HTMLElement | null} */ (node.offsetParent);
      if (!parent) break;
      left += parent.clientLeft || 0;
      top += parent.clientTop || 0;
      node = parent;
    }
    var viewportRelative = node !== document.body && node !== document.documentElement;
    // An absolutely positioned element does not move with a scroller between it and its
    // containing block — only with scrollers at or above that block, which is `offsetParent`.
    // Everything else moves with every scroller above it. One resolved-value read, on an element
    // whose style the `offsetLeft` reads above have already forced up to date.
    var computed = window.getComputedStyle ? window.getComputedStyle(el) : null;
    var start = computed && computed.position === "absolute" ? el.offsetParent : el.parentElement;
    var ancestor = /** @type {HTMLElement | null} */ (viewportRelative && node === el ? null : start);
    while (ancestor) {
      left -= ancestor.scrollLeft || 0;
      top -= ancestor.scrollTop || 0;
      if (viewportRelative && ancestor === node) break;
      ancestor = ancestor.parentElement;
    }
    return { left: left, top: top, width: el.offsetWidth || 0, height: el.offsetHeight || 0 };
  }

  /**
   * Draw one overlay box on `vmId`.
   *
   * The ring marks the element's *resting* box, and it marks it at all times: it follows every
   * scroll, resize and reflow, including while one of our animations is running on the element.
   *
   * Two halves to that. `getBoundingClientRect()` reads the *animated* box — a Fade In Up would
   * sit the ring its `distance` below the element for the length of the play, and with a replay
   * on every slider release that is most of the time — so while our animation is running the box
   * comes from `layoutBox()`, which no transform can reach. But `layoutBox()` is not
   * `getBoundingClientRect()`: it rounds (`offsetWidth` is an integer), it cannot see an
   * *ancestor's* transform, and it reports the first fragment of a wrapped inline rather than the
   * union. So it is corrected by the difference between the two, taken the last time this element
   * was measured at rest, which cancels every such disagreement that does not change during the
   * play. Known limits are listed in `packages/bridge/README.md`.
   *
   * Deferring instead — leaving the box where it was until `animationend` — is what this used to
   * do, and it cannot work: six catalog 1.1.0 entries default to `iteration: infinite`, so for
   * them `animationend` never comes and the ring would be frozen at a stale `position: fixed` box
   * for as long as the element stayed selected.
   *
   * @param {HTMLElement | null} box
   * @param {string | null} vmId
   * @param {{ vmId: string | null, dx: number, dy: number, dw: number, dh: number }} state
   */
  function positionBox(box, vmId, state) {
    if (!box) return;
    var el = vmId ? elements.get(vmId) : undefined;
    if (!el || !vmId) {
      box.style.display = "none";
      state.vmId = null;
      return;
    }
    // Only an HTMLElement has an offset box. An `<svg>` (a first-class target: the clone gives it
    // a data-vm-id, and a spinning logo is the canonical use) reports every `offset*` as
    // undefined, so `layoutBox()` would be an empty box at the origin. Such an element is always
    // measured live: its ring follows the animated box rather than the resting one, but it is
    // never empty and it tracks scroll and layout like any other.
    var hasOffsetBox = typeof (/** @type {HTMLElement} */ (el).offsetWidth) === "number";
    var layout = hasOffsetBox ? layoutBox(el) : { left: 0, top: 0, width: 0, height: 0 };
    var left;
    var top;
    var width;
    var height;
    if (hasOffsetBox && isMidOwnAnimation(vmId)) {
      // A correction measured against some *other* element says nothing about this one. Dropping
      // it leaves `layoutBox()` uncorrected, which is still the resting box — that is how an
      // element selected while it is already animating gets a ring in the right place at once,
      // rather than one offset by whatever phase the animation happened to be in.
      if (state.vmId !== vmId) {
        state.dx = 0;
        state.dy = 0;
        state.dw = 0;
        state.dh = 0;
      }
      left = layout.left + state.dx;
      top = layout.top + state.dy;
      width = layout.width + state.dw;
      height = layout.height + state.dh;
    } else {
      var rect = el.getBoundingClientRect();
      left = rect.left;
      top = rect.top;
      width = rect.width;
      height = rect.height;
      state.dx = left - layout.left;
      state.dy = top - layout.top;
      state.dw = width - layout.width;
      state.dh = height - layout.height;
    }
    state.vmId = vmId;
    box.style.display = "block";
    box.style.left = left + "px";
    box.style.top = top + "px";
    box.style.width = width + "px";
    box.style.height = height + "px";
  }

  function syncOverlay() {
    positionBox(hoverBox, hoveredVmId, hoverBoxState);
    positionBox(selectBox, selectedVmId, selectBoxState);
  }

  var overlayResize = /** @type {ResizeObserver | null} */ (null);

  /**
   * Scroll and resize are not the only things that move a box. A late image or font load in the
   * clone shifts everything under it, and `baseStyles` can change the box itself. One observer on
   * the root plus the two elements the overlay is actually drawing catches all of it.
   *
   * This is a resync trigger like any other, so `positionBox` re-derives the box from it even
   * while one of our animations is running — which is the only way a reflow under an `infinite`
   * animation is ever caught, since `animationend` never arrives for one. There is still no
   * per-frame loop: nothing here chases the element through its animation.
   */
  function observeOverlayTargets() {
    if (!overlayResize) {
      // Read at call time: jsdom has none, and old engines may not either.
      var Ctor = window.ResizeObserver;
      if (!Ctor) return;
      overlayResize = new Ctor(scheduleOverlaySync);
      overlayResize.observe(document.documentElement);
    }
    var keep = /** @type {Element[]} */ ([document.documentElement]);
    if (hoveredVmId) {
      var hovered = elements.get(hoveredVmId);
      if (hovered) keep.push(hovered);
    }
    if (selectedVmId) {
      var selected = elements.get(selectedVmId);
      if (selected) keep.push(selected);
    }
    overlayResize.disconnect();
    for (var i = 0; i < keep.length; i += 1) overlayResize.observe(keep[i]);
  }

  /**
   * The one `resize` handler: the overlay's boxes move, and a root that has stopped being empty
   * releases the in-view elements it was holding (spec §6a). Both are cheap and neither reads
   * layout unless it has to.
   */
  function onResize() {
    recoverFromEmptyRoot();
    scheduleOverlaySync();
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
    return el ? elementInfoFor(vmId, el) : null;
  }

  /**
   * Whether one of our animations is applied to `el` or to anything above it.
   *
   * A CSS transform applies to the whole subtree, so a `figure` held on `rotateX(90deg)` takes
   * its `img` to zero height with it: asking only about the element's own assignment would still
   * measure the child mid-flight. `records` holds exactly the elements we have applied or are
   * previewing, so this is a Map lookup per ancestor and only on a page that has some of our
   * animation on it at all.
   *
   * @param {Element} el
   * @returns {boolean}
   */
  function underOurAnimation(el) {
    if (records.size === 0) return false;
    var node = /** @type {Element | null} */ (el);
    while (node && node.nodeType === 1) {
      var vmId = node.getAttribute(ID_ATTR);
      if (vmId && records.has(vmId)) return true;
      node = node.parentElement;
    }
    return false;
  }

  /**
   * The box an element RESTS at, which is the one every caller of `elementInfo` wants (DT-150).
   *
   * `getBoundingClientRect()` is the *animated* box. An `in-view` element below the fold is held
   * on its first keyframe for as long as it is off screen, so for a shrinking entrance it
   * measures smaller than it is, and for `rotateX(90deg)` it has no height at all — which drops
   * it under the size floor, out of `elements:list` entirely, and takes its children out of the
   * block they belong to. The same reads decide `visible`. None of that may depend on which
   * frame of an animation a query landed in.
   *
   * So while any of our animation is applied to the element or an ancestor, the box comes from
   * `layoutBox()`, which no transform can reach — the same substitution the selection ring makes
   * (see `positionBox`), minus its remembered correction, which belongs to one selected element.
   * With nothing of ours applied, the live rect is exact and is kept: it sees ancestor CSS
   * transforms of the page's own, wrapped inlines and sub-pixel widths, which `layoutBox()`
   * rounds or cannot reach (`packages/bridge/README.md`).
   *
   * @param {Element} el
   * @returns {{ left: number, top: number, width: number, height: number }}
   */
  function restingRect(el) {
    var rect = el.getBoundingClientRect();
    // Only an HTMLElement has an offset box; an `<svg>` reports every `offset*` as undefined and
    // is measured live, as the ring measures it.
    var hasOffsetBox = typeof (/** @type {HTMLElement} */ (el).offsetWidth) === "number";
    if (!hasOffsetBox || !underOurAnimation(el)) {
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }
    return layoutBox(el);
  }

  /**
   * `elementInfo` for a caller that already holds the element (`elements:query` walks the map).
   *
   * @param {string} vmId
   * @param {Element} el
   * @returns {import("./protocol").ElementInfo}
   */
  function elementInfoFor(vmId, el) {
    var rect = restingRect(el);
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
    positionBox(hoverBox, nearest, hoverBoxState);
    observeOverlayTargets();
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
   * Is an animation of this keyframes name running on the element right now?
   *
   * Feature-detected: jsdom has no `getAnimations`, and an engine without it simply treats every
   * cancel as real, which is the pre-`rewind` behaviour.
   *
   * @param {HTMLElement} el
   * @param {string} name
   */
  function hasLiveAnimation(el, name) {
    if (typeof el.getAnimations !== "function") return false;
    var running = el.getAnimations();
    for (var i = 0; i < running.length; i += 1) {
      if (running[i] && /** @type {CSSAnimation} */ (running[i]).animationName === name) return true;
    }
    return false;
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
    // The element has stopped moving, so whatever box the overlay is holding
    // for it is now stale: this is the resync `positionBox` defers to.
    if ((selectedVmId === vmId || hoveredVmId === vmId) && event.type !== "animationiteration") {
      scheduleOverlaySync();
    }
    if (!record.replaying) return;
    var assignment = effective(record);
    if (!assignment || event.animationName !== assignment.keyframesName) return;
    // `rewind()` cancels the outgoing animation before starting its replacement, and that cancel
    // is delivered a frame later, by which time the replacement is already running. Ending the
    // replay on it would kill the play we were asked for. Asking whether an animation of this
    // name is live *now* answers "was this cancel ours?" from state rather than from event
    // ordering, which is what makes it safe: engines coalesce the cancel away unpredictably.
    if (event.type === "animationcancel" && hasLiveAnimation(record.el, assignment.keyframesName)) return;
    record.replaying = false;
    // An in-view element that is still off-screen has to go back to a *new* animation paused at
    // its first keyframe, not to the one that just finished (spec D3). One that armed while the
    // forced play was running is a different matter: its normal arm state is "already playing",
    // and rewinding it there would start a third play on top of the replay and the arm play.
    if (record.applied && record.applied.trigger === "in-view" && !record.armed) rewind([record]);
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
    window.addEventListener("resize", onResize, false);
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
    positionBox(selectBox, vmId, selectBoxState);
    observeOverlayTargets();
  }

  // ---------------------------------------------------------------------------------------
  // Message dispatch
  // ---------------------------------------------------------------------------------------

  /**
   * Shell -> bridge handlers. A handler returns nothing when it succeeded, or a failure with the
   * `ack` error code. Types that are not in here are ignored on purpose, so the shell can add
   * message types (`mode`) before every frame in the wild serves a new bridge. The second argument
   * is the envelope `seq`, for the one handler (`elements:query`) whose answer has to carry it.
   *
   * @type {Record<string, (payload: any, seq?: number) => { ok: boolean; error?: string; unknownVmIds?: string[] } | void>}
   */
  var HANDLERS = {
    hello: function () {
      // A failed ack rather than a silent `ok: true`, so the shell is never told the handshake
      // succeeded when no `ready` followed. It does not need to do anything about it: the
      // DOMContentLoaded `ready` and the `hello` it re-sends on the iframe `load` event both
      // still come (spec D7).
      if (!announceReady()) return { ok: false };
    },

    apply: function (payload) {
      if (!validateApplied(payload)) return { ok: false, error: "invalid-payload" };
      var known = records.has(payload.vmId);
      var record = recordFor(payload.vmId);
      if (!record) return { ok: false, error: "unknown-element" };
      if (!setApplied(record, payload)) {
        // `setApplied` rejects before it mutates anything, so an element that already had an
        // assignment keeps it; an element that did not must not be left holding an empty record.
        if (!known) records.delete(payload.vmId);
        return { ok: false, error: "invalid-payload" };
      }
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
      // Take a reference on every keyframes body up front: a body that does not parse rejects
      // the batch before a single assignment has been torn down.
      var held = /** @type {string[]} */ ([]);
      for (var a = 0; a < list.length; a += 1) {
        if (!acquireKeyframes(list[a].keyframesName, list[a].keyframesCss)) {
          for (var b = 0; b < held.length; b += 1) releaseKeyframes(held[b]);
          return { ok: false, error: "invalid-payload" };
        }
        held.push(list[a].keyframesName);
      }
      // Spec §3: `state:load` clears every assignment *and* the preview, then applies the list.
      dropPreview();
      var open = /** @type {ElementRecord[]} */ ([]);
      records.forEach(function (record) {
        open.push(record);
      });
      for (var j = 0; j < open.length; j += 1) clearApplied(open[j]);
      var unknownVmIds = /** @type {string[]} */ ([]);
      for (var k = 0; k < list.length; k += 1) {
        var record = recordFor(list[k].vmId);
        if (!record) {
          if (unknownVmIds.indexOf(list[k].vmId) < 0) unknownVmIds.push(list[k].vmId);
          continue;
        }
        setApplied(record, list[k]);
      }
      for (var c = 0; c < held.length; c += 1) releaseKeyframes(held[c]);
      // A bulk load is not fatal when the page has moved on: it applies what it can and names
      // what it could not (spec §3 ack).
      return { ok: true, unknownVmIds: unknownVmIds };
    },

    replay: function (payload) {
      if (!payload || typeof payload !== "object") return { ok: false, error: "invalid-payload" };
      // An explicit `null` means every element; a missing key is a bug in the sender, not a
      // request to restart the whole page.
      if (!Object.prototype.hasOwnProperty.call(payload, "vmId")) return { ok: false, error: "invalid-payload" };
      var vmId = payload.vmId;
      if (vmId === null) {
        // One rewind for the whole page: N elements must cost one style recalculation, not N.
        var all = /** @type {ElementRecord[]} */ ([]);
        records.forEach(function (record) {
          if (armForReplay(record)) all.push(record);
        });
        rewind(all);
        return;
      }
      if (typeof vmId !== "string" || !VM_ID_RE.test(vmId)) return { ok: false, error: "invalid-payload" };
      if (!elements.has(vmId)) return { ok: false, error: "unknown-element" };
      var record = records.get(vmId);
      if (record) restart(record, true);
    },

    preview: function (payload) {
      if (!validateApplied(payload)) return { ok: false, error: "invalid-payload" };
      var known = records.has(payload.vmId);
      var record = recordFor(payload.vmId);
      if (!record) return { ok: false, error: "unknown-element" };
      // Acquire before anything is torn down, so a keyframes body that will not parse leaves
      // whatever was on screen exactly as it was.
      if (!acquireKeyframes(payload.keyframesName, payload.keyframesCss)) {
        if (!known) records.delete(payload.vmId);
        return { ok: false, error: "invalid-payload" };
      }
      if (previewVmId && previewVmId !== payload.vmId) dropPreview();
      var previous = record.preview;
      if (previous) releaseKeyframes(previous.keyframesName);
      record.preview = payload;
      previewVmId = payload.vmId;
      syncBaseRule(record);
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

    /**
     * Element discovery for the Phase 5 agent (spec §3). Read-only: one loop of measurements and
     * not a single style write, so the whole query costs at most one layout pass.
     */
    "elements:query": function (payload, seq) {
      // Without a usable `seq` the shell could not tell which query a list answers: post nothing.
      // `NaN` counts as unusable too, because `NaN !== NaN` can never be matched to a pending query.
      if (!isFiniteNumber(seq)) return;
      var invalid = { ok: false, error: "invalid-payload" };
      var p = payload === undefined || payload === null ? {} : payload;
      if (typeof p !== "object" || Array.isArray(p)) return invalid;
      var f = p.filter === undefined ? {} : p.filter;
      if (!f || typeof f !== "object" || Array.isArray(f)) return invalid;
      if (f.minWidth !== undefined && !isFiniteNumber(f.minWidth)) return invalid;
      if (f.minHeight !== undefined && !isFiniteNumber(f.minHeight)) return invalid;
      // `NaN` would survive the clamp below and turn the limit off, hence the explicit check.
      if (p.limit !== undefined && !isFiniteNumber(p.limit)) return invalid;
      var limit = Math.max(
        1,
        Math.min(ELEMENTS_QUERY_MAX, p.limit === undefined ? ELEMENTS_QUERY_LIMIT : Math.floor(p.limit)),
      );

      // Lower-cased once, as a lookup. An empty `tags` is a filter nothing passes, not "no filter".
      var tags = /** @type {Record<string, boolean> | null} */ (null);
      if (f.tags !== undefined) {
        if (!Array.isArray(f.tags)) return invalid;
        tags = Object.create(null);
        for (var t = 0; t < f.tags.length; t += 1) {
          if (typeof f.tags[t] !== "string") return invalid;
          /** @type {Record<string, boolean>} */ (tags)[f.tags[t].toLowerCase()] = true;
        }
      }
      var tagFilter = tags;
      var wantsButtonRole = !!tagFilter && tagFilter.button === true;
      var minWidth = /** @type {number | undefined} */ (f.minWidth);
      var minHeight = /** @type {number | undefined} */ (f.minHeight);

      var list = /** @type {import("./protocol").ElementInfo[]} */ ([]);
      var truncated = false;
      // `buildElementMap` inserts in document order and a Map iterates in insertion order: no sort,
      // no copy of the keys, no second lookup per element.
      var entries = elements.entries();
      for (var step = entries.next(); !step.done; step = entries.next()) {
        var vmId = step.value[0];
        var el = step.value[1];
        // The clone tags every element under <body>, and `elementInfo` reads `textContent` (the
        // whole subtree, for a wrapper). So tag and role are checked first, and an element that
        // does not match is never measured and its text is never read.
        if (tagFilter && !tagFilter[el.tagName.toLowerCase()] && !(wantsButtonRole && hasButtonRole(el))) continue;
        var info = elementInfoFor(vmId, el);
        if (!info.visible) continue;
        if (minWidth !== undefined && info.rect.width < minWidth) continue;
        if (minHeight !== undefined && info.rect.height < minHeight) continue;
        if (list.length === limit) {
          truncated = true;
          break;
        }
        list.push(info);
      }
      // Before the ack (spec §3): a shell awaiting the ack already holds the list when it lands.
      post("elements:list", {
        seq: seq,
        elements: list,
        truncated: truncated,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
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
    var result = null;
    try {
      result = handler(data.payload, data.seq) || null;
    } catch (error) {
      // A malformed payload must never leave the frame wedged.
      result = { ok: false, error: "invalid-payload" };
    }
    // The overlay may be sitting on a box that just changed size; the measurement itself lands
    // in a frame, outside `ack.ms`.
    if (hoveredVmId || selectedVmId) scheduleOverlaySync();
    // Finite, not just a number: an `ack { seq: NaN }` can never be matched (`NaN !== NaN`).
    if (isFiniteNumber(data.seq)) {
      var ack = /** @type {{ seq: number; ms: number; ok: boolean; error?: string; unknownVmIds?: string[] }} */ ({
        seq: data.seq,
        ms: now() - started,
        // A handler returns nothing when it simply succeeded; an object only fails the ack when
        // it says so, because `state:load` also uses the return value to carry `unknownVmIds`.
        ok: !result || result.ok !== false,
      });
      if (result && result.error) ack.error = result.error;
      if (result && result.unknownVmIds) ack.unknownVmIds = result.unknownVmIds;
      post("ack", ack);
    }
  }

  // Everything below only exists in a preview. A cloned page opened directly in a tab must stay
  // an ordinary page: links work, forms submit, no overlay, no crosshair (spec D7 / §2).
  if (hasShell) installShellBindings();

  function installShellBindings() {
    window.addEventListener("message", onMessage, false);

    // Capture phase, so the page's own handlers never see the event: the clone is a canvas, not
    // a site. Scripts are stripped at clone time, but inline `href="javascript:"` and plain
    // links are not, and either one navigating away would lose the designer's unsaved work.
    // Registered here rather than at init, so nothing can navigate in the gap before DOM ready.
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
  }
})();
