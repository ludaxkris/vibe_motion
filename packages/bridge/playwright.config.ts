import { defineConfig, devices } from "@playwright/test";

const isCI = Boolean(process.env.CI);

// No web server and no app: every request is fulfilled by `page.route` in e2e/harness.ts, so the
// parent page, the framed page and the bridge script each get their own origin without anything
// being served. These specs exist for the behaviour jsdom cannot see: real animations, real
// layout, a real IntersectionObserver and a real cascade.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["github"], ["list"]] : [["list"]],
  use: {
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
