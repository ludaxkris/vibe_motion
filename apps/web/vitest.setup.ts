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

// Node's `fetch` brand-checks `RequestInit.signal` against the `AbortSignal`
// class it captured at startup, but the jsdom environment has since replaced
// that global with jsdom's own — so any request carrying a signal throws
// "Expected signal to be an instance of AbortSignal" before it is sent.
// `vitest.node-globals.mjs` stashes Node's originals before jsdom loads; put
// them back. (Assigning works: Vitest's `populateGlobal` installs a setter that
// overrides the jsdom value.)
//
// The trade runs the other way too, and this is the half that is left: with
// Node's classes in place, a component that passes a signal to a DOM listener —
// `addEventListener(type, fn, { signal })`, the idiomatic way to unsubscribe —
// fails jsdom's own webidl check with "parameter 3 is not of type
// 'AbortSignal'". Such a component has to use an explicit
// `removeEventListener` cleanup, or the test has to build the signal from
// `jsdom.window.AbortController`.
const nodeGlobals = (globalThis as { __vmNodeGlobals?: Record<string, unknown> })
  .__vmNodeGlobals;
if (typeof nodeGlobals?.AbortController === "function") {
  globalThis.AbortController = nodeGlobals.AbortController as typeof AbortController;
  globalThis.AbortSignal = nodeGlobals.AbortSignal as typeof AbortSignal;
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
