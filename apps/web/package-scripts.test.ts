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

/**
 * DT-113: several worktrees share one machine, and the local e2e server used
 * to be a fixed `:3000` with `reuseExistingServer` on, so a run could silently
 * test ANOTHER worktree's `next dev`. Like the hooks above, a regression here
 * is invisible from inside the worktree that causes it — every gate stays
 * green — so assert the wiring instead.
 */
describe("local e2e never attaches to a foreign dev server (DT-113)", () => {
  const root = path.resolve(here, "../..");
  const read = (file: string) => readFileSync(path.join(root, file), "utf8");

  it("`pnpm e2e` goes through the free-port wrapper", () => {
    expect(scriptsOf(root).e2e).toBe("node scripts/e2e.mjs");
  });

  it("the web e2e gate asks for a free port", () => {
    expect(read("scripts/gates.mjs")).toMatch(
      /name: "web e2e \(playwright\)".*freePort: "VM_E2E_PORT"/,
    );
  });

  it("the Playwright config reuses a running server only on explicit opt-in", () => {
    const config = read("apps/e2e/playwright.config.ts");
    expect(config).toContain('process.env.VM_E2E_REUSE === "1"');
    // …and not the old unconditional form.
    expect(config).not.toMatch(/reuseExistingServer:\s*!isCI\s*,/);
  });

  it("the port probe binds the wildcard, like `next dev` does", () => {
    // A 127.0.0.1-only probe passes while something listens on [::1]:<port>.
    expect(read("scripts/free-port.mjs")).not.toMatch(/listen\([^)]*127\.0\.0\.1/);
  });
});
