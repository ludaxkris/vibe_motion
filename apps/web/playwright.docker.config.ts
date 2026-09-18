import { defineConfig, devices } from "@playwright/test";

/**
 * Full-stack config, used only inside the Docker e2e stack (`pnpm e2e:docker`, see
 * docker/e2e/README.md). No `webServer`: the stack already runs a production web build, the real
 * api image and Postgres, and the runner reaches them by service name.
 *
 * Runs every spec: the web-only ones in `e2e/` and the full-stack ones in `e2e/stack/`.
 */

const webOrigin = required("E2E_WEB_ORIGIN");
const apiOrigin = required("E2E_API_ORIGIN");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run this config through scripts/e2e-docker.sh`);
  return value;
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "/out/test-results",
  fullyParallel: true,
  forbidOnly: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "/out/html", open: "never" }]],
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // http://web:3000 is not localhost, so Chromium would not treat it as a secure context
          // and would withhold APIs the app gets in production over https (crypto.randomUUID,
          // clipboard). Same code paths as production, without TLS inside the stack.
          args: [`--unsafely-treat-insecure-origin-as-secure=${webOrigin},${apiOrigin}`],
        },
      },
    },
  ],
});
