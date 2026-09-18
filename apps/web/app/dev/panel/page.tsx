import { notFound, redirect } from "next/navigation";

import { env } from "@/lib/env";

/**
 * The Control Panel gallery moved to `/dev`, which shows every panel state
 * alongside the dialogs, the toast and the Entry states. Kept as a redirect so
 * links and bookmarks to the old path still land somewhere useful — and still
 * 404 in production, like everything under `/dev`.
 */
export default function DevPanelPage(): never {
  if (env.isProduction) notFound();
  redirect("/dev");
}
