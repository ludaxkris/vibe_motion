"use client";

/**
 * The read-only layer over the preview sheet while a past version is on
 * screen: "Preview dims (white 45% overlay) and a floating black pill banner
 * (top centre)" (`docs/design/README.md` "History tab").
 *
 * It covers the preview only — never the Control Panel, whose History tab is
 * how the reader got here and how they pick another version. Being a layer
 * over the iframe, it is also what stops the cloned page being clicked
 * through: the preview is `stateAt(vN)`, not a draft, and there is nothing to
 * select on it (`docs/user_flow.md` §6).
 */
import { ViewingBanner } from "@/components/history/viewing-banner";
import type { VersionHistory } from "@/components/history/use-version-history";

export function ViewingOverlay({ history }: { history: VersionHistory }) {
  const { viewing, viewingVersionId, viewingLabel, currentLabel, nextLabel } = history;
  // Both labels come off the versions list, so an overlay is only ever drawn
  // once the list can name what the banner promises.
  if (!viewing || viewingVersionId === null || !viewingLabel || !currentLabel) return null;

  return (
    <div
      data-testid="viewing-overlay"
      className="absolute inset-0 z-10 flex justify-center bg-vm-surface/45 pt-4"
    >
      <ViewingBanner
        viewingLabel={viewingLabel}
        currentLabel={currentLabel}
        nextLabel={nextLabel}
        onRestore={() => void history.restore(viewingVersionId)}
        onBack={history.back}
        restoring={history.restoring}
      />
    </div>
  );
}
