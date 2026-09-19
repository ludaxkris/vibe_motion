/**
 * msw/browser worker, started by `MockProvider` when `env.apiMocking` is true.
 *
 * `public/mockServiceWorker.js` is the generated worker script this registers
 * (`pnpm exec msw init public/ --save`); it is committed, not built.
 */
import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

/**
 * Starts the worker at most once, no matter how many times this is called.
 * Guards against React Strict Mode's double effect invocation in dev
 * (`MockProvider`), which would otherwise call `worker.start()` twice
 * concurrently and throw ("cannot configure an already enabled network").
 */
let startPromise: ReturnType<typeof worker.start> | undefined;

export function startWorker(): ReturnType<typeof worker.start> {
  if (!startPromise) {
    startPromise = worker.start({ onUnhandledRequest: "bypass" });
  }
  return startPromise;
}
