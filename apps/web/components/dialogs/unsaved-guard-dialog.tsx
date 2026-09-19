"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/** The handoff's width for the guard (`docs/design/README.md` "3. Dialogs & toast"). */
export const UNSAVED_GUARD_DIALOG_WIDTH = "w-[380px]";

/** Why Save is inert here — version history is Phase 6, and nothing may fake a save. */
const SAVE_NOTE = "Saving arrives with version history.";

export type UnsavedGuardDialogContentProps = {
  /**
   * The element to name — its `data-vm-id` until the bridge sends a tag and
   * text (Phase 4).
   *
   * Only ever set when that element's changes are *all* the unsaved changes
   * there are: Discard reverts the whole draft, so a named question has to
   * describe everything it would revert (`lib/store`'s `selectGuardedVmId`).
   */
  elementLabel?: string;
  /** The animation on that element, when it has one. */
  animationName?: string;
  /**
   * How many elements have unsaved changes. Counted out loud in the generic
   * copy from two up, so the question is never smaller than the Discard.
   */
  unsavedElementCount?: number;
  /** "v5": the version a discard leaves standing. */
  currentVersionLabel?: string;
  onDiscard: () => void;
  onKeepEditing: () => void;
  onSave?: () => void;
  /** Phase 6 passes `false` once Save has a version to write. */
  saveDisabled?: boolean;
  /** Supplied by the modal wrapper so the popup can point `aria-labelledby` here. */
  titleId?: string;
  descriptionId?: string;
};

/**
 * The guard's body, without a portal or a focus trap, so `/dev` can stage it
 * open inside a frame while the editor renders the same markup inside the real
 * `Dialog`.
 */
export function UnsavedGuardDialogContent({
  elementLabel,
  animationName,
  unsavedElementCount,
  currentVersionLabel,
  onDiscard,
  onKeepEditing,
  onSave,
  saveDisabled = true,
  titleId,
  descriptionId,
}: UnsavedGuardDialogContentProps) {
  const generated = useId();
  const headingId = titleId ?? `${generated}-title`;
  const bodyId = descriptionId ?? `${generated}-description`;

  const leaves = currentVersionLabel
    ? `discard to leave ${currentVersionLabel} as is.`
    : "discard to leave the saved version as is.";

  // One element's worth of changes needs no arithmetic; from two up the
  // sentence says how far the Discard reaches.
  const changes =
    unsavedElementCount !== undefined && unsavedElementCount > 1
      ? `You have unsaved changes on ${unsavedElementCount} elements.`
      : "You have unsaved changes.";

  return (
    <div data-testid="unsaved-guard-dialog" className="flex flex-col gap-3">
      <p id={headingId} className="text-lg leading-[1.3] font-semibold">
        {elementLabel ? `Save changes to ${elementLabel}?` : "Save changes?"}
      </p>

      <p id={bodyId} className="text-md leading-body text-vm-ink-2">
        {animationName ? (
          <>
            You changed <b className="font-medium text-vm-ink">{animationName}</b> on this element
            but haven&rsquo;t saved. Save to keep it as a new version, or {leaves}
          </>
        ) : (
          <>
            {changes} Save to keep them as a new version, or {leaves}
          </>
        )}
      </p>

      <div className="mt-1.5 flex items-center gap-2">
        {/* Destructive actions are red text links, on the left (handoff, "Copy rules"). */}
        <Button variant="danger-link" onClick={onDiscard}>
          Discard
        </Button>
        <Button variant="secondary" className="ml-auto" onClick={onKeepEditing}>
          Keep editing
        </Button>
        <Button disabled={saveDisabled} onClick={onSave}>
          Save
        </Button>
      </div>

      {saveDisabled ? <p className="text-xs leading-body text-vm-ink-2">{SAVE_NOTE}</p> : null}
    </div>
  );
}

/**
 * "Save changes to h1?" — the modal that stands between unsaved work and an
 * action that would drop it (`docs/user_flow.md` §1; `docs/design/README.md`
 * "3. Dialogs & toast").
 *
 * Presentational and fully controlled: it neither reads the store nor calls the
 * API. Dismissing it — Esc, a click outside — is "Keep editing", the only
 * outcome that loses nothing.
 */
export function UnsavedGuardDialog({
  open,
  ...content
}: UnsavedGuardDialogContentProps & { open: boolean }) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : content.onKeepEditing())}>
      <DialogContent
        showCloseButton={false}
        className={UNSAVED_GUARD_DIALOG_WIDTH}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <UnsavedGuardDialogContent {...content} titleId={titleId} descriptionId={descriptionId} />
      </DialogContent>
    </Dialog>
  );
}
