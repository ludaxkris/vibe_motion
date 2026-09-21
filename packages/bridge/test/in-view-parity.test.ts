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
 * SELF-ARMING. The corrected DT-095/DT-179 rule for the bridge is in PR #27
 * (`fix/bridge-in-view-reachability`); until it lands, `vm-bridge.js` here is still Phase 4's
 * single-threshold rule and has neither function, so the cross-file assertions cannot run. Rather
 * than a blanket `describe.skip` that depends on a human remembering, this file asks the file
 * itself: the export copy is asserted unconditionally, and only the bridge half is skipped — the
 * moment #27 is on `main`, these run with no edit here at all.
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

/** Whether `vm-bridge.js` has adopted the shared rule yet (PR #27). */
function bridgeHasRule(): boolean {
  const source = read("vm-bridge.js");
  return SHARED_FUNCTIONS.every((name) => source.includes(`function ${name}(`));
}

describe("in-view firing rule: bridge vs export (DT-190)", () => {
  it("the export copy carries the guard a collapsed root needs", () => {
    // Asserted here as well as in `export-script.test.ts` so this file says something true on
    // every branch: whatever the bridge has adopted, the export's copy is pinned.
    expect(normalise(functionSource(read("vibe-motion-export.js"), "reachableFraction"))).toContain(
      "if (!(size > 0) || !(rootSize > 0)) return 1;",
    );
  });

  if (!bridgeHasRule()) {
    // One visibly-named skip rather than a silent pass: a reader of the output learns why, and
    // it disappears on its own the moment the bridge adopts the rule.
    it.skip(
      "vm-bridge.js has not adopted the shared rule yet (PR #27 / fix/bridge-in-view-reachability) — " +
        "these comparisons arm themselves the moment it has, with no edit here",
      () => {},
    );
  } else {
    for (const name of SHARED_FUNCTIONS) {
      it(`${name} is the same in vm-bridge.js and vibe-motion-export.js`, () => {
        const bridge = normalise(functionSource(read("vm-bridge.js"), name));
        const exported = normalise(functionSource(read("vibe-motion-export.js"), name));

        expect(bridge).toBe(exported);
      });
    }

    it("the bridge copy carries the guard too", () => {
      expect(normalise(functionSource(read("vm-bridge.js"), "reachableFraction"))).toContain(
        "if (!(size > 0) || !(rootSize > 0)) return 1;",
      );
    });
  }
});
