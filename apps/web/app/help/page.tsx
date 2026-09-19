import type { Metadata } from "next";

import { HelpScreen } from "@/components/help/help-screen";
import { REDUCED_MOTION_DEMO_CSS } from "@/components/help/reduced-motion";
import { CURRENT_CATALOG_VERSION, catalogKeyframes, getCatalogEntries } from "@/lib/catalog";

export const metadata: Metadata = {
  title: "Animation catalog · Vibe Motion",
  description: "Every animation Vibe Motion can apply to a cloned page.",
};

/**
 * `/help` — the catalog, live (`docs/design/README.md` "4. Help").
 *
 * A Server Component: the catalog is read at build time from the
 * `animation-catalog` package, and the `@keyframes` for every entry are
 * emitted once, here, as `<style id="vm-runtime">` — the same stylesheet the
 * preview bridge will inject into a cloned page (Phase 4), from the same
 * `lib/runtime-css`. The cards are the client half; they only set
 * `animation-*` on their demo block.
 *
 * That makes this page a visual test of the catalog: what plays here is what
 * the editor applies and what the exporter ships.
 */
export default function HelpPage() {
  const entries = getCatalogEntries();

  return (
    <>
      {/* Everything in here comes from the catalog and from this repo, never
          from a user or a cloned page. That matters because `<style>` is raw
          text while React escapes `<`, `>` and `&` in a text child: a catalog
          string carrying one would arrive as `&lt;` and corrupt the CSS.
          `app/help/page.test.tsx` holds the catalog to that. */}
      <style id="vm-runtime">
        {`${catalogKeyframes(
          entries.map((entry) => [entry, CURRENT_CATALOG_VERSION] as const),
        )}\n\n${REDUCED_MOTION_DEMO_CSS}`}
      </style>
      <HelpScreen entries={entries} catalogVersion={CURRENT_CATALOG_VERSION} />
    </>
  );
}
