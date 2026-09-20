/**
 * The one line above the Animate tab while a past version is on screen:
 * "Controls in Animate are disabled while viewing" (`docs/design/README.md`
 * "History tab") needs a reason, and the way out.
 *
 * A safety net rather than a step of the flow: leaving the History tab comes
 * back to the current version first (behaviour 9), so the normal path never
 * shows an Animate tab that is inert — this and that `inert` are what make
 * the state safe if it is ever reached another way.
 *
 * Rendered outside the inert content it explains, so it stays readable and
 * reachable by assistive technology.
 */
export function ReadOnlyNote({
  /** "v3" — the version on screen. */
  viewingLabel,
  /** "v5" — the version the reader has to come back to in order to edit. */
  currentLabel,
}: {
  viewingLabel: string;
  currentLabel: string;
}) {
  return (
    <p className="px-1 pt-1 pb-2 text-xs leading-body text-vm-ink-2">
      Viewing {viewingLabel} — read-only. Go back to {currentLabel} to edit.
    </p>
  );
}
