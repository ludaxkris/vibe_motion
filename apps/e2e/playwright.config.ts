import { defineConfig, devices } from "@playwright/test";

// VM_E2E_PORT moves this run's dev server off :3000. `pnpm e2e` and `pnpm gates` set it to a free
// port for every local run, because several worktrees share one machine and a fixed port meant
// either a refused start or, worse, specs silently running against another worktree's server
// (DT-113). Run Playwright directly without it and you get :3000, and a loud failure if it is taken.
const pinnedPort = process.env.VM_E2E_PORT;
const PORT = pinnedPort ? Number(pinnedPort) : 3000;
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`VM_E2E_PORT must be a TCP port, got "${pinnedPort}"`);
}
const baseURL = `http://localhost:${PORT}`;
const isCI = Boolean(process.env.CI);

export default defineConfig({
  // One directory per client under test; mobile/ joins web/ when there is a mobile client.
  testDir: "./web",
  // Full-stack specs need the Docker stack (api + Postgres + fixtures): `pnpm e2e:docker`.
  testIgnore: "**/stack/**",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["github"], ["list"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Explicit port so an ambient PORT (Render sets one) cannot move the server.
    command: `pnpm --filter web exec next dev --port ${PORT}`,
    url: baseURL,
    // Never attach to whatever already answers on the port: it may be another worktree's code.
    // VM_E2E_REUSE=1 is the explicit opt-in for the one case where reuse is right: the `pnpm dev`
    // you started yourself in THIS worktree (a second `next dev` here would hit Next's dev lock).
    reuseExistingServer: !isCI && process.env.VM_E2E_REUSE === "1",
    timeout: 120_000,
    // The real Ktor API (apps/api) isn't running in this phase's e2e — serve
    // it from the MSW mocks instead (mocks/, gated by lib/env.ts#apiMocking).
    env: { NEXT_PUBLIC_API_MOCKING: "enabled" },
  },
});
