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
 * 4. Remembers what has played, and puts `vm-play` back if something removes it (DT-187). A
 *    snippet is pasted into someone else's site, and a React/Vue host owns `class` on the elements
 *    it renders: its next re-render writes `className` from its own state, `vm-play` disappears
 *    from an element nothing is observing any more, and the hold rule pauses it on its first
 *    keyframe for good.
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

  /**
   * Every element that has been released, so a `class` rewritten by the host can be repaired
   * (DT-187). A `WeakSet` because the page owns these elements and may remove them at any time.
   */
  var played = new WeakSet();

  /**
   * Release one element: it plays, and it is remembered as having played.
   *
   * @param {Element} element
   */
  function play(element) {
    played.add(element);
    element.classList.add(PLAY_CLASS);
  }

  /** Release every held element. The answer to every failure, because a hidden element is worse. */
  function playEverything() {
    var held = document.querySelectorAll(MARKER_SELECTOR);
    for (var i = 0; i < held.length; i++) play(held[i]);
  }

  /**
   * The largest fraction of `size` that can ever be inside a root of `rootSize`, per axis.
   *
   * A root with no size is "there is no viewport yet", not "nothing can ever be seen here": a
   * collapsed iframe, a closed accordion, a transient zero-height layout, or a `window.innerHeight`
   * of 0 standing in for a null `rootBounds`. Answering 0 there would put every element under the
   * threshold, and an element the browser reports as edge-adjacent would fire unseen — once, and
   * then never again for the reader, because the export unobserves what it has played. So a
   * sizeless root reports 1 (fully reachable) and the element waits for a real viewport.
   *
   * @param {number} size
   * @param {number} rootSize
   * @returns {number}
   */
  function reachableFraction(size, rootSize) {
    // A zero box never intersects, so it never gets here; the guard is against dividing by it.
    if (!(size > 0) || !(rootSize > 0)) return 1;
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
    /** @type {IntersectionObserver | null} */
    var observer = null;

    if (typeof window.IntersectionObserver !== "function") {
      playEverything();
    } else {
      try {
        observer = new window.IntersectionObserver(
          // The observer arrives as the second argument, so nothing has to close over a variable
          // that is still being assigned.
          function (entries, self) {
            try {
              for (var i = 0; i < entries.length; i++) {
                var entry = entries[i];
                if (!isOnScreen(entry)) continue;
                play(entry.target);
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
        observer = null;
      }
    }

    if (observer !== null) {
      try {
        observeWithin(observer, document);
      } catch (observeError) {
        playEverything();
        observer = null;
      }
    }

    // Watched whether or not there is an observer: without one everything has already been
    // played, and a host re-render can still drop `vm-play` from it.
    watchDom(observer);
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
   * Watch the document for the two things that happen to marked elements after load.
   *
   * **Late arrivals.** Snippet mode is made to be pasted into someone else's site, and those are
   * frequently client-rendered: an element that appears later must be observed like any other —
   * held, then played when it is reached — not force-played and not left hidden for ever. With no
   * observer to hand (nothing to observe with, so everything on the page was played already) a
   * late arrival is played on sight, for the same reason.
   *
   * **A rewritten `class`.** A framework host re-renders an element by writing the whole
   * attribute from its own state, which drops `vm-play` from an element that has already played
   * and is no longer observed. `.vm-in-view:not(.vm-play)` would then pause it on its first
   * keyframe for ever, so it is put back (DT-187). No loop: the element already carries the class
   * on the record that our own write produces, so the second pass writes nothing.
   *
   * A browser with `IntersectionObserver` and no `MutationObserver` does not exist; if one did,
   * the elements present at load would still work and only late arrivals and repairs would be
   * missed, so there is nothing here worth playing everything over.
   *
   * @param {IntersectionObserver | null} observer
   */
  function watchDom(observer) {
    if (typeof window.MutationObserver !== "function") return;

    new window.MutationObserver(function (records) {
      try {
        for (var i = 0; i < records.length; i++) {
          var record = records[i];

          if (record.type === "attributes") {
            var target = /** @type {Element} */ (record.target);
            if (played.has(target)) {
              // A host re-render rewrote `class` and took `vm-play` with it.
              if (!target.classList.contains(PLAY_CLASS)) target.classList.add(PLAY_CLASS);
              continue;
            }
            // The mirror case: an element that *gains* the marker from the
            // host (`className={open ? "vm-a1 vm-in-view" : "vm-a1"}`) arrives
            // with no node insertion, so nothing else here would ever see it —
            // and the hold rule applies the moment the class lands.
            if (!target.classList.contains(MARKER_CLASS)) continue;
            // `observe` on an element already being observed is a no-op.
            if (observer === null) play(target);
            else observer.observe(target);
            continue;
          }

          var added = record.addedNodes;
          for (var j = 0; j < added.length; j++) {
            var node = added[j];
            if (node.nodeType !== 1) continue;
            if (observer === null) playMarkedWithin(/** @type {Element} */ (node));
            else observeWithin(observer, /** @type {Element} */ (node));
          }
        }
      } catch (mutationError) {
        playEverything();
      }
    }).observe(document.documentElement, {
      childList: true,
      subtree: true,
      // Only `class`, and only to repair it: every other attribute the host owns is its own
      // business, and a filtered observer is one comparison per record.
      attributes: true,
      attributeFilter: ["class"],
    });
  }

  /**
   * Play every marked element in `root`, `root` itself included — the no-observer fallback's
   * half of {@link observeWithin}.
   *
   * @param {Element} root
   */
  function playMarkedWithin(root) {
    if (root.classList && root.classList.contains(MARKER_CLASS)) play(root);
    var targets = root.querySelectorAll(MARKER_SELECTOR);
    for (var i = 0; i < targets.length; i++) play(targets[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
