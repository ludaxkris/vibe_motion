"use client";

/**
 * The two modals the save flow drives, mounted once by the editor shell.
 *
 * Both are presentational and fully controlled (they neither read the store
 * nor call the API); this is only the switch between them, so
 * `useSaveFlow`'s state has one place to be rendered and the shell has one
 * line to mount. Each is mounted only while it is open — `Dialog` renders
 * nothing when closed, and a fresh mount is what puts the Save dialog's focus
 * back on the label field every time it opens.
 */
import { ConflictDialog, type ConflictDialogContentProps } from "@/components/dialogs/conflict-dialog";
import { SaveDialog, type SaveDialogContentProps } from "@/components/dialogs/save-dialog";

/** The Save dialog's props, less the two the modal wrapper supplies itself. */
export type SaveFlowSaveProps = Omit<SaveDialogContentProps, "titleId" | "inputRef">;
export type SaveFlowConflictProps = Omit<ConflictDialogContentProps, "titleId" | "descriptionId">;

export type SaveFlowDialogsProps = {
  /** Present exactly while the Save dialog is open. */
  save?: SaveFlowSaveProps;
  /** Present exactly while the 409's rebase/discard question is open. */
  conflict?: SaveFlowConflictProps;
};

export function SaveFlowDialogs({ save, conflict }: SaveFlowDialogsProps) {
  return (
    <>
      {save ? <SaveDialog open {...save} /> : null}
      {conflict ? <ConflictDialog open {...conflict} /> : null}
    </>
  );
}
