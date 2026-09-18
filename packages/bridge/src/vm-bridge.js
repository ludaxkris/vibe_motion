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
  var IN_VIEW_THRESHOLD = 0.2;

  // Kept byte-for-byte in sync with src/protocol.ts (test/render.test.ts asserts it).
  var VM_ID_RE = /^vm-[a-z0-9-]+$/;
  var KEYFRAMES_NAME_RE = /^vm-[a-z0-9-]+$/;
  var STYLE_KEY_RE = /^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/;

  var RUNTIME_STYLE_ID = "vm-runtime";
  var OVERLAY_ATTR = "data-vm-overlay";
  var ID_ATTR = "data-vm-id";
  var ID_SELECTOR = "[data-vm-id]";
})();
