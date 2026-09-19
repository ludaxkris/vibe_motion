import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `animation-catalog` resolves to its gitignored `dist/`, so every entry point
 * that loads the web app has to build the package first. A missing `pre*` hook
 * is only visible in a *fresh* worktree — where `pnpm dev` or `pnpm e2e` dies
 * with a module-not-found — which is exactly the case a local run never
 * reproduces. Assert the hooks instead.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

function scriptsOf(packageDir: string): Record<string, string> {
  return JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8")).scripts;
}

const CATALOG_BUILD = "pnpm --filter animation-catalog build";

describe("web package scripts", () => {
  const scripts = scriptsOf(here);

  it.each(["dev", "build", "lint", "typecheck", "test"])(
    "%s builds the animation-catalog package first",
    (script) => {
      expect(scripts[script]).toBeDefined();
      expect(scripts[`pre${script}`]).toBe(CATALOG_BUILD);
    },
  );
});

/**
 * e2e moved to its own package (`apps/e2e`), but its Playwright `webServer`
 * still starts *this* app — with `pnpm --filter web exec next dev`, and `exec`
 * runs no `pre*` hook. So the catalog build has to be hung off the e2e
 * package's own `test`, which is what `pnpm e2e` and `scripts/gates.mjs` call.
 */
describe("e2e package scripts", () => {
  const scripts = scriptsOf(path.resolve(here, "../e2e"));

  it("builds the animation-catalog package before starting the web dev server", () => {
    expect(scripts.test).toBeDefined();
    expect(scripts.pretest).toBe(CATALOG_BUILD);
  });
});
