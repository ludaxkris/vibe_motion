import { notFound } from "next/navigation";

import { env } from "@/lib/env";

import { HistoryShowcase } from "./history-showcase";

/**
 * `/dev/history` — every state of the History tab's presentational pieces,
 * for reading against the Claude Design mocks without driving the editor
 * there. 404s in production like the rest of `/dev` (`app/dev/panel/page.tsx`).
 *
 * Not linked from `dev-gallery.tsx` yet: Track B wires the real History tab
 * into the editor and adds the link once it exists.
 */
export default function DevHistoryPage() {
  if (env.isProduction) notFound();
  return <HistoryShowcase />;
}
