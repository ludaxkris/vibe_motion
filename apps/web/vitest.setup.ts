import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";

import { resetDb } from "./mocks/db";
import { server } from "./mocks/server";

// Node 22+ defines an inert global `localStorage`/`sessionStorage` (an object
// with no methods, unless the --experimental-webstorage flag is set). When
// vitest's jsdom environment merges jsdom's `window` onto the global object,
// it only fills in properties that are *missing* from `globalThis` — so
// Node's inert stub wins over jsdom's real, working Storage implementation.
// Swap the real one back in so `localStorage` behaves as it does in an actual
// browser (this repo's `SplitPane` persists to it).
const jsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
if (jsdomWindow && typeof jsdomWindow.localStorage.getItem === "function") {
  Object.defineProperty(globalThis, "localStorage", {
    value: jsdomWindow.localStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    value: jsdomWindow.sessionStorage,
    configurable: true,
    writable: true,
  });
}

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
