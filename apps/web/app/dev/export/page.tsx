import { notFound } from "next/navigation";

import { env } from "@/lib/env";

import { ExportFrames } from "./export-frames";

/**
 * Dev-only: every Export tab state at its real width, for reading against the
 * Claude Design mocks and for the screenshot runner. 404s in production, like
 * everything under `/dev` — the live trigger for these states is the API, and
 * this route is how they get seen outside tests.
 *
 * Its own route rather than a row in `/dev`: the gallery is edited by two open
 * PRs, and Track C is where the two meet.
 */
export default function DevExportPage() {
  if (env.isProduction) notFound();
  // Pages own their `<main>`: `app/layout.tsx` is chrome-free so a screen's
  // top bar can stay a banner.
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <ExportFrames />
    </main>
  );
}
