"use client";

import { useEffect, useState } from "react";

import { env } from "@/lib/env";

/**
 * Starts the MSW browser worker (`mocks/browser.ts`) before rendering
 * `children`, but only when `env.apiMocking` is true. Mounted once in
 * `app/providers.tsx`.
 *
 * The worker module is imported dynamically so it — and `msw` — never end up
 * in a production bundle unless `NEXT_PUBLIC_API_MOCKING=enabled` was set at
 * build time; Playwright's `webServer` sets it for e2e.
 *
 * Renders nothing while the worker is starting so the app never fires a real
 * `fetch` before the service worker is ready to intercept it.
 */
export function MockProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!env.apiMocking);

  useEffect(() => {
    if (!env.apiMocking) return;

    let cancelled = false;
    void import("./browser")
      .then(({ startWorker }) => startWorker())
      .catch((error: unknown) => {
        // A worker that will not register is worth a line in the console, but
        // never a blank page: `ready` gates the whole tree, and the app is
        // still usable (against a real API, or on a route that calls none).
        // Dev and e2e only — `lib/env.ts` bars mocking from a production build.
        console.error("Vibe Motion: the mock API worker failed to start.", error);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
