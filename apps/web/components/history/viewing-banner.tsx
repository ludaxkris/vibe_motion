"use client";

import { Button } from "@/components/ui/button";

export type ViewingBannerProps = {
  /** "v3" — the version currently on screen. */
  viewingLabel: string;
  /** "v5" — the version Back returns to. */
  currentLabel: string;
  /** "v6" — the version number a restore would create. */
  nextLabel: string;
  onRestore: () => void;
  onBack: () => void;
  restoring?: boolean;
};

/**
 * The floating pill over a dimmed preview while a past version is on screen:
 * "Viewing v3 · read-only" plus Restore / Back
 * (`docs/design/README.md` "History tab").
 *
 * Presentational, so the editor decides when it mounts (`viewingVersionId`)
 * and where its Restore ends up (a new version, never the one being viewed).
 */
export function ViewingBanner({
  viewingLabel,
  currentLabel,
  nextLabel,
  onRestore,
  onBack,
  restoring = false,
}: ViewingBannerProps) {
  return (
    <div
      data-slot="viewing-banner"
      className="flex items-center gap-3 rounded-pill bg-vm-ink px-3.5 py-2 text-sm font-medium text-vm-ink-inverse shadow-popover"
    >
      <span className="whitespace-nowrap">
        Viewing {viewingLabel} · read-only
      </span>
      <div className="flex items-center gap-2">
        <Button variant="bar-primary" disabled={restoring} onClick={onRestore}>
          Restore as {nextLabel}
        </Button>
        <Button variant="bar-outline" disabled={restoring} onClick={onBack}>
          Back to {currentLabel}
        </Button>
      </div>
    </div>
  );
}
