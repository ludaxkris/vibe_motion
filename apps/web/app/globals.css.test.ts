/**
 * Token parity: `app/globals.css` must carry every custom property from the
 * design handoff's token files, with the same value.
 *
 * `docs/design/` is a reference package, never imported by the app (Phase 3
 * plan, "Design handoff"), so the tokens are copied into `globals.css` by
 * hand. This test is the copy's guard rail: it reads the four source files and
 * fails the moment a name or a value drifts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = path.resolve(HERE, "../../../docs/design/design-system/tokens");
const GLOBALS_CSS = path.join(HERE, "globals.css");

const TOKEN_FILES = ["colors.css", "typography.css", "spacing.css", "motion.css"] as const;

/** `--name: value;` declarations, in source order. Comments are stripped first. */
function parseDeclarations(css: string): [name: string, value: string][] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [
    name,
    value.replace(/\s+/g, " ").trim(),
  ]);
}

/**
 * Declarations from the top-level, unconditional `:root { … }` blocks only.
 *
 * Anything nested in an at-rule is deliberately skipped: `@theme inline` holds
 * the Tailwind mapping (which may alias a token under another key) and
 * `@media (prefers-reduced-motion: reduce)` collapses the duration tokens — so
 * neither should be able to satisfy, or break, this check.
 */
function rootDeclarations(css: string): Map<string, string> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = new Map<string, string>();

  let depth = 0;
  let index = 0;
  while (index < withoutComments.length) {
    const character = withoutComments[index];
    if (character === "}") {
      depth -= 1;
      index += 1;
      continue;
    }
    if (character === "{") {
      depth += 1;
      index += 1;
      continue;
    }
    if (depth === 0 && withoutComments.startsWith(":root", index)) {
      const open = withoutComments.indexOf("{", index);
      const close = withoutComments.indexOf("}", open);
      if (open === -1 || close === -1) break;
      for (const [name, value] of parseDeclarations(withoutComments.slice(open + 1, close + 1))) {
        // Last declaration wins, as it would in the cascade.
        declarations.set(name, value);
      }
      index = close + 1;
      continue;
    }
    index += 1;
  }

  return declarations;
}

describe("globals.css design tokens", () => {
  const applied = rootDeclarations(readFileSync(GLOBALS_CSS, "utf8"));

  for (const file of TOKEN_FILES) {
    describe(file, () => {
      const tokens = parseDeclarations(readFileSync(path.join(TOKENS_DIR, file), "utf8"));

      it("is not empty", () => {
        expect(tokens.length).toBeGreaterThan(0);
      });

      it.each(tokens)("defines %s", (name, value) => {
        expect(applied.get(name)).toBe(value);
      });
    });
  }
});
