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
   * The largest fraction of `size` that can ever be inside a root of `rootSize`, per axis.
   *
   * @param {number} size
   * @param {number} rootSize
   * @returns {number}
   */
  function reachableFraction(size, rootSize) {
    // A zero box never intersects, so it never gets here; the guard is against dividing by it.
    if (!(size > 0)) return 1;
    return Math.min(1, rootSize / size);
  }

  /**
   * Whether this entry counts as "on screen".
   *
   * `intersectionRatio` is intersected area over the element's whole area, so an element bigger
   * than the viewport can never reach 1 — and one big enough can never reach the threshold at all,
   * which would hold it on its first keyframe for ever. The best ratio it could ever reach is the
   * fraction that fits, in each axis, multiplied: when even that is under the threshold the ratio
   * test is unreachable and the element fires as soon as it intersects.
   *
   * An **area**, not a height: a 4000px-wide track in a horizontal scroller reaches 0.16 with
   * nothing wrong with its height at all, and a 1280x1200 element is short of the threshold on
   * neither axis alone.
   *
   * `rootBounds` is null when this page is itself inside a cross-origin iframe, so the viewport
   * stands in for both axes; reading `.height` off null would throw and hold everything for ever.
   *
   * Still not covered, and logged: a clip container narrower than the root, which bounds the
   * intersection without appearing in `rootBounds`.
   *
   * @param {IntersectionObserverEntry} entry
   * @returns {boolean}
   */
  function isOnScreen(entry) {
    if (!entry.isIntersecting) return false;
    if (entry.intersectionRatio >= IN_VIEW_THRESHOLD) return true;
    var box = entry.boundingClientRect;
    var rootBounds = entry.rootBounds;
    var rootWidth = rootBounds ? rootBounds.width : window.innerWidth;
    var rootHeight = rootBounds ? rootBounds.height : window.innerHeight;
    var reachable = reachableFraction(box.width, rootWidth) * reachableFraction(box.height, rootHeight);
    // `<=`, not `<`: an element whose best possible ratio is exactly the threshold can only reach
    // it perfectly aligned, which is a question of float rounding rather than of being on screen.
    return reachable <= IN_VIEW_THRESHOLD;
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
      observeWithin(observer, document);
      watchForLateArrivals(observer);
    } catch (observeError) {
      playEverything();
    }
  }

  /**
   * Observe every marked element in `root`, `root` itself included.
   *
   * @param {IntersectionObserver} observer
   * @param {Document | Element} root
   */
  function observeWithin(observer, root) {
    if (root.nodeType === 1 && /** @type {Element} */ (root).classList.contains(MARKER_CLASS)) {
      observer.observe(/** @type {Element} */ (root));
    }
    var targets = root.querySelectorAll(MARKER_SELECTOR);
    for (var i = 0; i < targets.length; i++) observer.observe(targets[i]);
  }

  /**
   * Pick up marked elements that arrive after `DOMContentLoaded`.
   *
   * Snippet mode is made to be pasted into someone else's site, and those are frequently
   * client-rendered: an element that appears later must be observed like any other — held, then
   * played when it is reached — not force-played and not left hidden for ever.
   *
   * A browser with `IntersectionObserver` and no `MutationObserver` does not exist; if one did,
   * the elements present at load would still work and only late arrivals would be missed, so
   * there is nothing here worth playing everything over.
   *
   * @param {IntersectionObserver} observer
   */
  function watchForLateArrivals(observer) {
    if (typeof window.MutationObserver !== "function") return;

    new window.MutationObserver(function (records) {
      try {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType === 1) observeWithin(observer, /** @type {Element} */ (node));
          }
        }
      } catch (mutationError) {
        playEverything();
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
