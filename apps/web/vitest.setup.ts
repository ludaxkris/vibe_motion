import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { resetDb } from "./mocks/db";
import { server } from "./mocks/server";

// Vitest runs without globals, so React Testing Library's auto-cleanup does not
// register itself. Do it here.
afterEach(() => {
  cleanup();
});

// MSW: fail loudly on any request without a matching handler rather than
// hitting the real network. Started at the setup file's top level, not inside
// `beforeAll`: `lib/api-client` (openapi-fetch) reads `globalThis.fetch` once,
// at `createClient()` time, when the test file's imports are evaluated — which
// happens *before* `beforeAll` hooks run. Starting msw here, synchronously,
// guarantees its fetch patch is in place before that capture happens.
server.listen({ onUnhandledRequest: "error" });

afterEach(() => {
  server.resetHandlers();
  resetDb();
});

afterAll(() => {
  server.close();
});
