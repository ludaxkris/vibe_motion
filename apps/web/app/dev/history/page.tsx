import { notFound } from "next/navigation";

import { env } from "@/lib/env";

import { HistoryShowcase } from "./history-showcase";

/**
 * `/dev/history` — every state of the History tab's presentational pieces,
 * for reading against the Claude Design mocks without driving the editor
 * there. 404s in production like the rest of `/dev` (`app/dev/panel/page.tsx`).
 *
 * Its own page rather than a frame in `/dev`: a version list, a dimmed
 * preview and the conflict dialog need more width than the gallery's columns.
 * `/dev` links here.
 */
export default function DevHistoryPage() {
  if (env.isProduction) notFound();
  return <HistoryShowcase />;
}
