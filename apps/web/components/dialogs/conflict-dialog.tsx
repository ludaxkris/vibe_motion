"use client";

import { useId } from "react";

import { UNSAVED_GUARD_DIALOG_WIDTH } from "@/components/dialogs/unsaved-guard-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { Version } from "@/lib/api-client";

export type ConflictDialogContentProps = {
  /** The version that landed first — `POST /versions`'s 409 body. */
  theirs: Version;
  /** Apply my changes on top: rebase the draft onto `theirs` and retry the save. */
  onRebase: () => void;
  /** Discard my changes: drop the draft and go to `theirs`. */
  onDiscard: () => void;
  /** Keep editing: close the dialog, draft untouched. */
  onCancel: () => void;
  /** Supplied by the modal wrapper so the popup can point `aria-labelledby` here. */
  titleId?: string;
  /** Supplied by the modal wrapper so the popup can point `aria-describedby` here. */
  descriptionId?: string;
};

/**
 * The guard's body, without a portal or a focus trap, so `/dev` can stage it
 * open inside a frame while the editor renders the same markup inside the
 * real `Dialog` (mirrors `unsaved-guard-dialog.tsx`).
 */
export function ConflictDialogContent({
  theirs,
  onRebase,
  onDiscard,
  onCancel,
  titleId,
  descriptionId,
}: ConflictDialogContentProps) {
  const generated = useId();
  const headingId = titleId ?? `${generated}-title`;
  const bodyId = descriptionId ?? `${generated}-description`;

  return (
    <div data-testid="conflict-dialog" className="flex flex-col gap-3">
      <p id={headingId} className="text-lg leading-[1.3] font-semibold">
        v{theirs.seq} was saved somewhere else
      </p>

      <p id={bodyId} className="text-md leading-body text-vm-ink-2">
        {theirs.label ? (
          <>
            Someone saved <b className="font-medium text-vm-ink">{theirs.label}</b> as v
            {theirs.seq}{" "}
          </>
        ) : (
          <>Someone saved v{theirs.seq} </>
        )}
        while you were editing. Discard your changes, keep editing here, or apply your changes on
        top of it.
      </p>

      <div className="mt-1.5 flex items-center gap-2">
        {/* Destructive actions are red text links, on the left (handoff, "Copy rules"). */}
        <Button variant="danger-link" onClick={onDiscard}>
          Discard my changes
        </Button>
        <Button variant="secondary" className="ml-auto" onClick={onCancel}>
          Keep editing
        </Button>
        <Button onClick={onRebase}>Apply my changes on top</Button>
      </div>
    </div>
  );
}

/**
 * "v6 was saved somewhere else" — the 409 a save collides with another save
 * of the same parent version (`docs/design/README.md`: "409 → rebase/discard
 * dialog (not designed yet — reuse the guard dialog layout)").
 *
 * Presentational and fully controlled: it neither reads the store nor calls
 * the API. Dismissing it — Esc, a click outside — is "Keep editing", the only
 * outcome that loses nothing.
 */
export function ConflictDialog({
  open,
  ...content
}: ConflictDialogContentProps & { open: boolean }) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : content.onCancel())}>
      <DialogContent
        showCloseButton={false}
        className={UNSAVED_GUARD_DIALOG_WIDTH}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <ConflictDialogContent {...content} titleId={titleId} descriptionId={descriptionId} />
      </DialogContent>
    </Dialog>
  );
}
