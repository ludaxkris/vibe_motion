import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IN_VIEW_THRESHOLD } from "../src/protocol";
import { callable, functionSource } from "./source";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(here, "..", "src", "vibe-motion-export.js");
const SOURCE = readFileSync(SCRIPT_PATH, "utf8");

/**
 * What the file *is*, rather than what it does — the real-browser behaviour lives in
 * `e2e/export-script.spec.ts`, because jsdom has no `IntersectionObserver`, no layout and no
 * animations.
 *
 * The one thing that matters most here: the exporter returns this file byte for byte, so nothing
 * may ever be interpolated into it.
 */
describe("vibe-motion-export.js", () => {
  it("repeats IN_VIEW_THRESHOLD exactly, since a classic script cannot import protocol.ts", () => {
    const declared = /var IN_VIEW_THRESHOLD = ([0-9.]+);/.exec(SOURCE);

    expect(declared).not.toBeNull();
    expect(Number(declared?.[1])).toBe(IN_VIEW_THRESHOLD);
  });

  it("contains nothing that looks like a placeholder to interpolate into", () => {
    // The exporter serves this file unchanged. A `${…}` or `{{…}}` left in it would be a template
    // somebody meant to fill, and a string concatenated in by the API would be an injection point.
    expect(SOURCE).not.toContain("${");
    expect(SOURCE).not.toContain("{{");
    expect(SOURCE).not.toContain("%s");
    expect(SOURCE).not.toMatch(/__[A-Z_]+__/);
  });

  it("parses as a classic script, not a module", () => {
    expect(() => execFileSync(process.execPath, ["--check", SCRIPT_PATH])).not.toThrow();
    expect(SOURCE).not.toMatch(/^\s*(import|export)\s/m);
  });

  it("names the three classes the exported stylesheet and HTML agree on", () => {
    expect(SOURCE).toContain('var GATE_CLASS = "vm-js";');
    expect(SOURCE).toContain('var MARKER_CLASS = "vm-in-view";');
    expect(SOURCE).toContain('var PLAY_CLASS = "vm-play";');
  });

  it("needs no network, no eval and no inline injection, so a host CSP cannot break it", () => {
    expect(SOURCE).not.toMatch(/\beval\s*\(/);
    expect(SOURCE).not.toMatch(/new Function\s*\(/);
    expect(SOURCE).not.toMatch(/\bfetch\s*\(/);
    expect(SOURCE).not.toMatch(/XMLHttpRequest/);
    expect(SOURCE).not.toMatch(/innerHTML/);
  });

  it("guards every path that could leave an element held at opacity: 0", () => {
    // One release function, called from the no-observer path, the constructor path, the callback
    // path, the observe path and the mutation path. `e2e/export-script.spec.ts` drives them for
    // real, including a mutant check that the callback's own guard is load-bearing.
    const releases = SOURCE.match(/playEverything\(\);/g) ?? [];
    expect(releases.length).toBeGreaterThanOrEqual(5);
  });

  it("guards the root as a whole, not per axis, before the ratio test", () => {
    // 640x0 with a 4000x60 track: unreachable on width (0.16), "fully reachable" on the empty
    // height axis (1), product under the threshold — so a per-axis guard fires it while nothing
    // is visible. And the test must precede the ratio line: a zero-area target that intersects is
    // reported at ratio 1.
    const guard = "if (!(rootWidth > 0) || !(rootHeight > 0)) return false;";
    expect(SOURCE).toContain(guard);
    expect(SOURCE.indexOf(guard)).toBeLessThan(
      SOURCE.indexOf("if (entry.intersectionRatio >= IN_VIEW_THRESHOLD) return true;"),
    );
  });

  it("treats a root with no size as 'no viewport yet', not as 'unreachable'", () => {
    // The escape hatch asks "could this element ever reach the threshold in a root this size?".
    // With a root of zero width or height — an exported page in a collapsed iframe, a closed
    // accordion, a transient zero-height layout, or `window.innerHeight === 0` standing in for a
    // null `rootBounds` — `min(1, 0 / size)` is 0, which is under the threshold, so an element
    // the browser reports as edge-adjacent would fire unseen. The export plays once and
    // unobserves, so it would then never play for the reader at all.
    const reachableFraction = callable(SOURCE, "reachableFraction", IN_VIEW_THRESHOLD);

    expect(reachableFraction(60, 0)).toBe(1);
    expect(reachableFraction(0, 400)).toBe(1);
    // Unchanged for every root that has a size.
    expect(reachableFraction(200, 400)).toBe(1);
    expect(reachableFraction(2000, 400)).toBe(0.2);
    expect(reachableFraction(4000, 640)).toBe(0.16);
  });

  it("decides reachability by area, with the caller's root measurement on both axes", () => {
    // Height alone leaves a wide track — 4000px in a horizontal scroller — held for ever, because
    // `intersectionRatio` is an area ratio. The fallbacks are parameters: the rule is shared with
    // `vm-bridge.js` byte for byte (DT-190) and only the call site knows how to measure the root.
    expect(SOURCE).toContain("rootBounds ? rootBounds.width : fallbackWidth");
    expect(SOURCE).toContain("rootBounds ? rootBounds.height : fallbackHeight");
    expect(SOURCE).toContain(
      "reachableFraction(box.width, rootWidth) * reachableFraction(box.height, rootHeight)",
    );
    expect(SOURCE).toContain("reachable <= IN_VIEW_THRESHOLD");
  });

  it("measures the root itself, once per callback, and only where the browser does not", () => {
    // `documentElement.clientWidth/clientHeight` is the viewport without the scrollbar gutter —
    // in standards mode. In quirks mode it is the whole DOCUMENT box (measured 4400px in a 400px
    // frame), which makes a tall hero look reachable and holds it for ever, so there the answer
    // is `innerWidth`/`innerHeight`. An export inherits the cloned page's doctype, or its
    // absence, so both modes are real.
    const rootSize = functionSource(SOURCE, "rootSize");
    expect(rootSize).toContain('document.compatMode === "CSS1Compat"');
    expect(rootSize).toContain("root.clientWidth || 0");
    expect(rootSize).toContain("root.clientHeight || 0");
    expect(rootSize).toContain("window.innerWidth || 0");
    expect(rootSize).toContain("window.innerHeight || 0");
    // Once per callback, not once per entry.
    const callback = functionSource(SOURCE, "onIntersect");
    expect(callback.match(/rootSize\(\)/g)).toHaveLength(1);
    expect(callback).toContain("isOnScreen(entry, root.width, root.height)");
  });

  it("latches an empty root in the callback and never clears it there", () => {
    // On restore, the entries that DO arrive (other elements flipping to `isIntersecting`) reach
    // the callback before the `resize` does. A callback that cleared the latch on a non-empty
    // root would drop the recovery, and the elements with no entry of their own — ratio 0 to a
    // ratio still under the threshold — would stay at `opacity: 0` for ever.
    const callback = functionSource(SOURCE, "onIntersect");

    expect(callback).toContain("if (!(root.width > 0) || !(root.height > 0)) rootWasEmpty = true;");
    expect(callback).not.toContain("rootWasEmpty = false");
  });

  it("clears the latch only in the recovery, and re-observes only what has not played", () => {
    const recovery = functionSource(SOURCE, "watchRootSize");

    // The cheap path first: a root that has never been empty costs one boolean test on each
    // resize, not a layout read.
    expect(recovery.indexOf("if (!rootWasEmpty) return;")).toBeLessThan(recovery.indexOf("rootSize()"));
    expect(recovery).toContain("rootWasEmpty = false;");
    expect(recovery).toContain("if (played.has(held[i])) continue;");
    expect(recovery).toContain("observer.unobserve(held[i]);");
    expect(recovery).toContain("observer.observe(held[i]);");
    expect(recovery).toContain('"resize"');
  });

  it("watches for marked elements that arrive after DOMContentLoaded", () => {
    // Snippet mode is pasted into client-rendered sites; an element that appears later has to be
    // observed like any other rather than left hidden.
    expect(SOURCE).toContain("new window.MutationObserver(");
    expect(SOURCE).toContain("childList: true");
    expect(SOURCE).toContain("subtree: true");
  });

  it("remembers what has played, and watches `class` so a host cannot re-hold it (DT-187)", () => {
    // A framework host that re-renders an element writes the whole `class` attribute from its own
    // state, dropping `vm-play` from an element nothing is observing any more. Without this the
    // hold rule pauses it on its first keyframe for good.
    expect(SOURCE).toContain("new WeakSet()");
    expect(SOURCE).toContain("attributeFilter: [\"class\"]");
    expect(SOURCE).toContain("played.has(target)");
    // …and the mirror: an element that GAINS the marker from the host has to
    // be picked up, or nothing ever observes it and the hold rule keeps it.
    expect(SOURCE).toContain("target.classList.contains(MARKER_CLASS)");
    // Guarded, so our own repair does not write again on the record it produces.
    expect(SOURCE).toContain("!target.classList.contains(PLAY_CLASS)");
  });
});
