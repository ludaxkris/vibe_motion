import type { VersionHistory } from "./use-version-history";

/**
 * The one line above the Animate tab while a past version is on screen:
 * "Controls in Animate are disabled while viewing" (`docs/design/README.md`
 * "History tab") needs a reason, and the way out.
 *
 * Outside the inert content it explains, so it stays readable and reachable
 * by assistive technology. Renders nothing unless it can name both versions.
 */
export function ReadOnlyNote({ history }: { history?: VersionHistory }) {
  if (!history?.viewing || !history.viewingLabel || !history.currentLabel) return null;

  return (
    <p className="px-1 pt-1 pb-2 text-xs leading-body text-vm-ink-2">
      Viewing {history.viewingLabel} — read-only. Go back to {history.currentLabel} to edit.
    </p>
  );
}
