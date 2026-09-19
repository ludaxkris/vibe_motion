import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
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
    reuseExistingServer: !isCI,
    timeout: 120_000,
    // The real Ktor API (apps/api) isn't running in this phase's e2e — serve
    // it from the MSW mocks instead (mocks/, gated by lib/env.ts#apiMocking).
    env: { NEXT_PUBLIC_API_MOCKING: "enabled" },
  },
});
