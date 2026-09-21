import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { functionSource } from "./source";

/**
 * DT-190: the preview and the export must fire `in-view` on the same condition.
 *
 * `src/vm-bridge.js` (what the designer previews) and `src/vibe-motion-export.js` (what the
 * reader of the exported page gets) each carry their own copy of the rule, because one is a
 * module-free IIFE served to a cloned page and the other a constant file served by the API —
 * neither can import from the other. Two copies drift; this is what stops them drifting
 * *silently*. When the rule changes, both files change in the same PR or this goes red.
 *
 * Compared as normalised source rather than by behaviour: these are the same few lines of
 * arithmetic in two files, and "identical, modulo comments and whitespace" is the claim worth
 * making. Their *behaviour* is proved in a real browser by `e2e/bridge.spec.ts` and
 * `e2e/export-script.spec.ts` respectively.
 *
 * SKIPPED ON THIS BRANCH. `vm-bridge.js` here is still the single-threshold rule from Phase 4:
 * it has neither `reachableFraction` nor `isOnScreen`, because the corrected DT-095/DT-179 rule
 * for the bridge is in PR #27 (`fix/bridge-in-view-reachability`), which also adds the zero-root
 * guard this file's export copy just grew. Whoever merges second un-skips this — no other change
 * should be needed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(path.join(here, "..", "src", name), "utf8");

/** The two functions that decide, between them, whether an `in-view` element fires. */
const SHARED_FUNCTIONS = ["reachableFraction", "isOnScreen"] as const;

/**
 * Source with `//` comments, JSDoc blocks and whitespace runs removed, so the two copies may
 * differ in how they explain themselves but not in what they do.
 *
 * Deliberately naive about `//` inside a string or a regex: neither appears in these functions,
 * and a parser here would be a bigger thing to trust than the code it checks.
 */
export function normalise(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe.skip("in-view firing rule: bridge vs export (DT-190, un-skip after PR #27)", () => {
  for (const name of SHARED_FUNCTIONS) {
    it(`${name} is the same in vm-bridge.js and vibe-motion-export.js`, () => {
      const bridge = normalise(functionSource(read("vm-bridge.js"), name));
      const exported = normalise(functionSource(read("vibe-motion-export.js"), name));

      expect(bridge).toBe(exported);
    });
  }

  it("both copies guard a root with no size", () => {
    // The one line DT-190 was opened over: without it a collapsed root puts every element under
    // the threshold and fires it unseen.
    for (const file of ["vm-bridge.js", "vibe-motion-export.js"]) {
      expect(normalise(functionSource(read(file), "reachableFraction"))).toContain(
        "if (!(size > 0) || !(rootSize > 0)) return 1;",
      );
    }
  });
});
