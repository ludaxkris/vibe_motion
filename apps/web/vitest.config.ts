import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

// JSX is transformed by esbuild using tsconfig's `jsx: react-jsx`; no React
// plugin is needed because tests never use Fast Refresh.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
    // e2e belongs to Playwright.
    exclude: ["node_modules/**", ".next/**", "e2e/**", "playwright-report/**"],
  },
});
