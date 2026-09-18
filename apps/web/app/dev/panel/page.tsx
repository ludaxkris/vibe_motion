import { notFound } from "next/navigation";

import { env } from "@/lib/env";

import { DevPanelDemo } from "./dev-panel-demo";

/**
 * Dev-only: every Control Panel state side by side, plus a live instance
 * driven by buttons that fire `panel-machine` events. 404s in production —
 * element selection from the preview iframe (Phase 4) is the real trigger for
 * these states; until then this route is how they get exercised outside tests.
 */
export default function DevPanelPage() {
  if (env.isProduction) notFound();
  // Minimal landmark until Task 9 re-skins this route: `app/layout.tsx` no
  // longer wraps pages in `<main>` (the top bar has to stay a banner).
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <DevPanelDemo />
    </main>
  );
}
