import { notFound } from "next/navigation";

import { env } from "@/lib/env";

import { DevGallery } from "./dev-gallery";

/**
 * Dev-only: every editor and entry state side by side, at its real width, for
 * reading against the Claude Design mocks and for the screenshot runner.
 * 404s in production — the live triggers for these states are the preview
 * iframe and the API, and this route is how they get seen outside tests.
 */
export default function DevPage() {
  if (env.isProduction) notFound();
  // Pages own their `<main>`: `app/layout.tsx` is chrome-free so a screen's
  // top bar can stay a banner.
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <DevGallery />
    </main>
  );
}
