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
  return <DevPanelDemo />;
}
