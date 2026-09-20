"use client";

import { cn } from "cn";
import { useId, useRef, type Ref } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ElementTag } from "@/components/ui/element-tag";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { MAX_LABEL_LENGTH, type DiffRow, type DiffRowKind } from "@/lib/diff-summary";

/** The handoff's width for the Save dialog (`docs/design/README.md` "3. Dialogs & toast"). */
export const SAVE_DIALOG_WIDTH = "w-[420px]";

/**
 * The sign column's colours: `--diff-add` / `--diff-change` / `--diff-remove`,
 * which the token file aliases to success / warning / danger.
 */
export const SIGN_CLASS: Readonly<Record<DiffRowKind, string>> = {
  added: "text-vm-success",
  changed: "text-vm-warning",
  removed: "text-vm-danger",
};

/** What the sign glyph means, for anyone who cannot see its colour. */
export const KIND_WORD: Readonly<Record<DiffRowKind, string>> = {
  added: "Added",
  changed: "Changed",
  removed: "Removed",
};

/**
 * One diff row: sign · mono `data-vm-id` chip · name · meta. Shared with
 * `components/history/version-row.tsx`, whose expanded rows render the same
 * shape (`docs/design/README.md` "History tab").
 */
export function ChangeRow({ row }: { row: DiffRow }) {
  return (
    <li className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden="true"
        className={cn("w-2 shrink-0 text-center font-mono text-sm", SIGN_CLASS[row.kind])}
      >
        {row.sign}
      </span>
      <span className="sr-only">{KIND_WORD[row.kind]}</span>
      <ElementTag tone="muted" size="sm" className="max-w-[72px] truncate">
        {row.vmId}
      </ElementTag>
      <span className="min-w-0 flex-1 truncate text-md font-medium">{row.name}</span>
      {row.meta ? (
        <span className="max-w-[45%] shrink-0 truncate text-xs text-vm-ink-2" title={row.meta}>
          {row.meta}
        </span>
      ) : null}
    </li>
  );
}

export type SaveDialogContentProps = {
  /** "v6" — the version this save would create. */
  nextVersionLabel: string;
  /** "v5" — the version it forks from. Absent for the very first save. */
  fromVersionLabel?: string;
  /** The label field's value; the caller prefills it from `summariseDiff`. */
  label: string;
  onLabelChange: (label: string) => void;
  changes: readonly DiffRow[];
  onCancel: () => void;
  onSave?: () => void;
  /**
   * Defaults closed, like the guard's: a caller that has not wired up
   * `POST /versions` — `/dev`, a showcase frame — gets a primary that says it
   * cannot save rather than one that looks live and does nothing.
   */
  saveDisabled?: boolean;
  /**
   * A save the service refused or could not complete, shown here rather than
   * as a toast: the dialog stays open on top of the draft it failed to write,
   * so the label can be fixed and Save tried again.
   */
  error?: string;
  /**
   * The `POST` is in flight. Save is refused because the write is already on
   * its way, and Cancel because there is no longer anything to cancel —
   * dismissing mid-flight would leave the save flow's promise unsettled.
   */
  saving?: boolean;
  /** The modal wrapper focuses the label field through this (handoff: it opens focused). */
  inputRef?: Ref<HTMLInputElement>;
  /** Supplied by the modal wrapper so the popup can point `aria-labelledby` here. */
  titleId?: string;
};

/**
 * The Save dialog's body, without a portal or a focus trap, so `/dev` can stage
 * it open inside a frame while the editor renders the same markup inside the
 * real `Dialog`.
 */
export function SaveDialogContent({
  nextVersionLabel,
  fromVersionLabel,
  label,
  onLabelChange,
  changes,
  onCancel,
  onSave,
  saveDisabled = true,
  error,
  saving = false,
  inputRef,
  titleId,
}: SaveDialogContentProps) {
  const generated = useId();
  const headingId = titleId ?? `${generated}-title`;
  const fieldId = `${generated}-label`;
  const changesId = `${generated}-changes`;

  return (
    <div data-testid="save-dialog" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <span id={headingId} className="text-lg leading-[1.3] font-semibold">
          Save as {nextVersionLabel}
        </span>
        {fromVersionLabel ? (
          <span className="shrink-0 text-sm text-vm-ink-2">from {fromVersionLabel}</span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel id={fieldId}>Label</SectionLabel>
        <Input
          ref={inputRef}
          aria-labelledby={fieldId}
          value={label}
          maxLength={MAX_LABEL_LENGTH}
          onChange={(event) => onLabelChange(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SectionLabel id={changesId}>Changes in this version</SectionLabel>
        {changes.length === 0 ? (
          <p className="text-sm text-vm-ink-2">Nothing has changed since the last version.</p>
        ) : (
          <ul aria-labelledby={changesId} className="flex flex-col gap-1.5">
            {changes.map((row) => (
              <ChangeRow key={`${row.kind}-${row.vmId}`} row={row} />
            ))}
          </ul>
        )}
      </div>

      {error ? (
        <p role="alert" className="text-sm leading-body text-vm-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-1.5 flex items-center justify-end gap-2">
        <Button variant="secondary" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={saveDisabled || saving} onClick={onSave}>
          Save version
        </Button>
      </div>
    </div>
  );
}

/**
 * "Save as v6" — the label and the change list a version is created from
 * (`docs/design/README.md` "3. Dialogs & toast").
 *
 * Presentational and fully controlled: it neither reads the store nor calls the
 * API. `POST /projects/{id}/versions` belongs to `useSaveFlow`; the rows come from
 * `summariseDiff` (`lib/diff-summary.ts`). Dismissing it is Cancel.
 */
export function SaveDialog({
  open,
  ...content
}: SaveDialogContentProps & { open: boolean }) {
  const id = useId();
  const titleId = `${id}-title`;
  // The handoff opens this dialog on the label field, not on the card.
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : content.onCancel())}>
      <DialogContent
        showCloseButton={false}
        className={SAVE_DIALOG_WIDTH}
        aria-labelledby={titleId}
        initialFocus={inputRef}
      >
        <SaveDialogContent {...content} titleId={titleId} inputRef={inputRef} />
      </DialogContent>
    </Dialog>
  );
}
