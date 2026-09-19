/**
 * Preloaded into every Vitest worker with `--import` (see `vitest.config.ts`),
 * which means it runs *before* the jsdom environment replaces the worker's
 * globals.
 *
 * Why: jsdom ships its own `AbortController`/`AbortSignal` and Vitest's jsdom
 * environment installs them over Node's. Node's `fetch` (undici) brand-checks
 * `RequestInit.signal` against the class it captured at startup — Node's — so
 * a jsdom signal makes `new Request(url, { signal })` throw
 * "Expected signal to be an instance of AbortSignal", and every request that
 * carries a signal fails before it is sent. Stashing Node's originals here lets
 * `vitest.setup.ts` put them back.
 */
globalThis.__vmNodeGlobals = {
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
};
