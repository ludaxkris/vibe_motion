import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { IN_VIEW_THRESHOLD } from "../src/protocol";

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

  it("decides reachability by area, with a viewport fallback on both axes", () => {
    // Height alone leaves a wide track — 4000px in a horizontal scroller — held for ever, because
    // `intersectionRatio` is an area ratio.
    expect(SOURCE).toContain("rootBounds ? rootBounds.width : window.innerWidth");
    expect(SOURCE).toContain("rootBounds ? rootBounds.height : window.innerHeight");
    expect(SOURCE).toContain(
      "reachableFraction(box.width, rootWidth) * reachableFraction(box.height, rootHeight)",
    );
    expect(SOURCE).toContain("reachable < IN_VIEW_THRESHOLD");
  });

  it("watches for marked elements that arrive after DOMContentLoaded", () => {
    // Snippet mode is pasted into client-rendered sites; an element that appears later has to be
    // observed like any other rather than left hidden.
    expect(SOURCE).toContain("new window.MutationObserver(");
    expect(SOURCE).toContain('{ childList: true, subtree: true }');
  });
});
