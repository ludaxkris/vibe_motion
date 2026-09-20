// @ts-check
/**
 * vibe-motion.js — the only JavaScript an exported page ever gets.
 *
 * The exporter returns this file **unchanged**: nothing is interpolated into it, ever. It is
 * emitted only when some assignment uses the `in-view` trigger; `load` and `hover` are plain CSS.
 *
 * What it does, and nothing else:
 *
 * 1. Adds `vm-js` to `<html>` immediately. Every `in-view` rule in `vibe-motion.css` is scoped to
 *    `:where(.vm-js)`, so without this file the element simply rests in its normal state instead of
 *    being stranded on a first keyframe of `opacity: 0`. The `<script>` tag is in `<head>` and is
 *    **not deferred** for this line alone: the class has to be there before the first paint, or an
 *    element in the first viewport paints at rest, snaps to its first keyframe and then plays.
 * 2. At `DOMContentLoaded`, observes every `.vm-in-view` with one `IntersectionObserver`.
 * 3. When an element is on screen, adds `vm-play` and stops observing it, so it plays **once** —
 *    a deliberate divergence from the editor preview, which re-arms on every entry
 *    (docs/plans/phase-4-bridge-protocol.md §6a).
 *
 * The overriding rule: **nothing may be left held at `opacity: 0`.** No `IntersectionObserver`, a
 * constructor that throws, a callback that throws — every one of those plays everything.
 *
 * Plain classic script: no imports, no exports, no build step, nothing that needs `eval`, so it
 * runs under a host's `script-src 'self'`. It cannot import `protocol.ts`, so it repeats
 * `IN_VIEW_THRESHOLD`; `test/export-script.test.ts` asserts the two copies agree.
 */
(function () {
  "use strict";

  /** Kept in sync with IN_VIEW_THRESHOLD in src/protocol.ts, and with the bridge's own copy. */
  var IN_VIEW_THRESHOLD = 0.2;

  var GATE_CLASS = "vm-js";
  var MARKER_CLASS = "vm-in-view";
  var PLAY_CLASS = "vm-play";
  var MARKER_SELECTOR = "." + MARKER_CLASS;

  var root = document.documentElement;
  if (root && root.classList) root.classList.add(GATE_CLASS);

  /** Release every held element. The answer to every failure, because a hidden element is worse. */
  function playEverything() {
    var held = document.querySelectorAll(MARKER_SELECTOR);
    for (var i = 0; i < held.length; i++) held[i].classList.add(PLAY_CLASS);
  }

  /**
   * Whether this entry counts as "on screen".
   *
   * The ratio test alone is unreachable for an element taller than `1 / IN_VIEW_THRESHOLD`
   * viewports, which would hold a tall hero on its first keyframe forever, so such an element
   * fires as soon as it intersects at all. `rootBounds` is null when this page is itself inside a
   * cross-origin iframe, and reading `.height` off null would throw.
   *
   * @param {IntersectionObserverEntry} entry
   * @returns {boolean}
   */
  function isOnScreen(entry) {
    if (!entry.isIntersecting) return false;
    if (entry.intersectionRatio >= IN_VIEW_THRESHOLD) return true;
    var rootHeight = entry.rootBounds ? entry.rootBounds.height : window.innerHeight;
    return entry.boundingClientRect.height * IN_VIEW_THRESHOLD >= rootHeight;
  }

  function start() {
    if (typeof window.IntersectionObserver !== "function") {
      playEverything();
      return;
    }

    var observer;
    try {
      observer = new window.IntersectionObserver(
        // The observer arrives as the second argument, so nothing has to close over a variable
        // that is still being assigned.
        function (entries, self) {
          try {
            for (var i = 0; i < entries.length; i++) {
              var entry = entries[i];
              if (!isOnScreen(entry)) continue;
              entry.target.classList.add(PLAY_CLASS);
              // Unobserved, so it plays once and never again.
              self.unobserve(entry.target);
            }
          } catch (callbackError) {
            playEverything();
          }
        },
        // Two thresholds: 0 so a very tall element is reported the moment it intersects at all,
        // and the real one for everything else.
        { threshold: [0, IN_VIEW_THRESHOLD] },
      );
    } catch (constructorError) {
      playEverything();
      return;
    }

    try {
      var targets = document.querySelectorAll(MARKER_SELECTOR);
      for (var j = 0; j < targets.length; j++) observer.observe(targets[j]);
    } catch (observeError) {
      playEverything();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
