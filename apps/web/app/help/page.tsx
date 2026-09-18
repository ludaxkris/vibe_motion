import type { Metadata } from "next";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CURRENT_CATALOG_VERSION, getCatalogEntries } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Animation catalog · Vibe Motion",
  description: "Every animation Vibe Motion can apply to a cloned page.",
};

/**
 * Help page (wireframe).
 *
 * Renders the catalog read at build time from `packages/animation-catalog/versions/`
 * (currently `lib/catalog.ts`'s pinned version — see `CURRENT_CATALOG_VERSION`).
 * Phase 3 replaces each card's body with a live demo driven by the same runtime
 * CSS generator the editor uses, so this page doubles as a visual test of the
 * catalog.
 */
export default function HelpPage() {
  const entries = getCatalogEntries();

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Animation catalog
        </h1>
        <p className="text-sm text-muted-foreground">
          {entries.length} animations in catalog {CURRENT_CATALOG_VERSION}. Live
          demos and default params land in Phase 3.
        </p>
      </header>

      <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <li key={entry.id}>
            <Card data-testid="catalog-card" className="h-full">
              <CardHeader>
                <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                  <span>{entry.name}</span>
                  <span className="rounded-full border px-2 py-0.5 text-[11px] font-normal text-muted-foreground">
                    {entry.category}
                  </span>
                </CardTitle>
                <CardDescription>{entry.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                <span className="font-mono">{entry.id}</span> ·{" "}
                {entry.params.length} params · triggers:{" "}
                {entry.triggers.join(", ")}
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
