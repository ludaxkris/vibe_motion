"use client";

/**
 * Shown when the project's current version could not be materialised
 * (`useProjectVersions`' `loadError`).
 *
 * The draft under it is empty while the project it belongs to may have saved
 * animations, which is a lie the screen cannot tell in silence: Save has
 * nothing to fork from and refuses, so without this the only feedback would
 * be a Save button that does nothing. Same shape as
 * `VersionMismatchBanner` — one line of `role="alert"` above the canvas, with
 * the one action that can fix it.
 */
import { Button } from "@/components/ui/button";

export function VersionLoadErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-vm-border bg-vm-accent-tint px-4 py-2 text-sm text-vm-ink"
    >
      <span>{message} Saving is off until it loads.</span>
      <Button variant="secondary" size="xs" className="ml-auto" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
