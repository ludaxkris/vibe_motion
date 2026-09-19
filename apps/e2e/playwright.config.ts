import { defineConfig, devices } from "@playwright/test";

/**
 * DT-113: several agents share one machine, and `reuseExistingServer` on a
 * fixed port silently attaches this suite to another checkout's `next dev` —
 * a false red, or worse a false green. Setting `E2E_WEB_PORT` takes a port of
 * your own and refuses to reuse anything, so a busy :3000 is no longer a
 * reason to distrust a local run. The default is unchanged.
 */
const explicitPort = process.env.E2E_WEB_PORT;
const PORT = Number(explicitPort ?? 3000);
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

/** Full-stack specs need the Docker stack (api + Postgres + fixtures): `pnpm e2e:docker`. */
const STACK_SPECS = "**/stack/**";
/** Measured alone, after everything else. */
const PERF_SPEC = "**/bridge-perf.spec.ts";

export default defineConfig({
  // One directory per client under test; mobile/ joins web/ when there is a mobile client.
  testDir: "./web",
  testIgnore: STACK_SPECS,
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: [STACK_SPECS, PERF_SPEC] },
    {
      // The performance spec measures wall-clock time under CPU throttling, so
      // it must not be measuring five other Chromium instances competing for
      // the same throttled CPU: `dependencies` holds it until every other spec
      // has finished, and `fullyParallel: false` keeps its own two tests in one
      // worker. Ignored by the Docker config, which never runs `mocked/`.
      name: "perf",
      testMatch: PERF_SPEC,
      dependencies: ["chromium"],
      fullyParallel: false,
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Explicit port so an ambient PORT (Render sets one) cannot move the server.
    command: `pnpm --filter web exec next dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !isCI && explicitPort === undefined,
    timeout: 120_000,
    // The real Ktor API (apps/api) isn't running in this phase's e2e — serve
    // it from the MSW mocks instead (mocks/, gated by lib/env.ts#apiMocking).
    env: { NEXT_PUBLIC_API_MOCKING: "enabled" },
  },
});
