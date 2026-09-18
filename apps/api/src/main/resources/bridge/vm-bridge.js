/*
 * Vibe Motion preview bridge — Phase 2 stub.
 *
 * Served at /bridge/vm-bridge.js and injected into the cloned page at serve time (never stored in
 * `projects.base_html`), so the protocol can change without touching a single saved project.
 *
 * This build does two things and nothing else:
 *   1. announces itself to the editor shell with a `ready` message, and
 *   2. keeps the clone from behaving like a browsable page (no navigation, no form submits).
 *
 * Phase 4 owns the real protocol — selection, hover outlines, apply/clear/replay, state:load.
 * Deliberately ES5, no build step, no dependencies: it runs inside someone else's page.
 */
(function () {
  "use strict";

  var BRIDGE_VERSION = "0.1.0-stub";
  var MESSAGE_SOURCE = "vibe-motion";

  var script = document.currentScript;
  var parentOrigin = script && script.dataset ? script.dataset.vmParentOrigin : null;

  function post(type, payload) {
    // No origin means no shell to talk to. Never fall back to "*": that would hand the cloned
    // page's contents to whatever frame happens to be embedding us.
    if (!parentOrigin || window.parent === window) return;
    try {
      window.parent.postMessage({ source: MESSAGE_SOURCE, type: type, payload: payload }, parentOrigin);
    } catch (error) {
      /* A blocked postMessage must not break the page the designer is looking at. */
    }
  }

  function announceReady() {
    post("ready", {
      elementCount: document.querySelectorAll("[data-vm-id]").length,
      bridgeVersion: BRIDGE_VERSION
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", announceReady, { once: true });
  } else {
    announceReady();
  }

  // Capture phase, so the page's own handlers never see the event: the clone is a canvas, not a
  // site. Scripts are stripped at clone time, but inline `href="javascript:"` and plain links are
  // not, and either one navigating away would lose the designer's unsaved work.
  document.addEventListener(
    "click",
    function (event) {
      event.preventDefault();
    },
    true
  );

  document.addEventListener(
    "submit",
    function (event) {
      event.preventDefault();
    },
    true
  );
})();
