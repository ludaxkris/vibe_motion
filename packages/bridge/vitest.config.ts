import { defineConfig } from "vitest/config";

// The tests build their own JSDOM per case (test/harness.ts) so each one gets an
// isolated document, window and a fresh evaluation of the bridge script. A shared
// `environment: "jsdom"` window would leak listeners between cases.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Several specs spy on a jsdom element's `setProperty` or on `getComputedStyle`; without
    // these a spy outlives the test that installed it.
    restoreMocks: true,
    clearMocks: true,
  },
});
