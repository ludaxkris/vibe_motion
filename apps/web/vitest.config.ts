import { fileURLToPath } from "node:url";

import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// Preloaded in each worker before Vitest swaps in jsdom's globals; see the file
// for what it rescues and why.
const nodeGlobals = fileURLToPath(new URL("./vitest.node-globals.mjs", import.meta.url));
const execArgv = ["--import", nodeGlobals];

// JSX is transformed by esbuild using tsconfig's `jsx: react-jsx`; no React
// plugin is needed because tests never use Fast Refresh.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    // e2e is Playwright's, and lives in apps/e2e (PR #11) — nothing to skip here.
    exclude: ["node_modules/**", ".next/**"],
    poolOptions: {
      forks: { execArgv },
      threads: { execArgv },
    },
  },
});
