import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `animation-catalog` resolves to its gitignored `dist/`, so every entry point
 * that loads the web app has to build the package first. A missing `pre*` hook
 * is only visible in a *fresh* worktree — where `pnpm dev` or a standalone
 * `pnpm --filter web e2e` dies with a module-not-found — which is exactly the
 * case a local run never reproduces. Assert the hooks instead.
 */
const scripts: Record<string, string> = JSON.parse(
  readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "package.json"),
    "utf8",
  ),
).scripts;

const CATALOG_BUILD = "pnpm --filter animation-catalog build";

describe("web package scripts", () => {
  it.each(["dev", "build", "typecheck", "test", "e2e"])(
    "%s builds the animation-catalog package first",
    (script) => {
      expect(scripts[script]).toBeDefined();
      expect(scripts[`pre${script}`]).toBe(CATALOG_BUILD);
    },
  );
});
