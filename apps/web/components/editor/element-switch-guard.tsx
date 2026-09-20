"use client";

/**
 * The unsaved-changes guard on an *element switch* (spec §5, owner decision
 * §9.1): clicking another element in the preview while the selected one has an
 * animation that was added or changed asks what to do first, and the selection
 * ring does not move until it is answered (spec D10).
 *
 * The dialog itself is the shared `UnsavedGuardDialog` — the same one the
 * Control Panel mounts for the tab switch. This is only the wiring: which
 * element is being left, what is on it, and which `resolveGuard` outcome each
 * button means. Two mountings rather than one lifted component is DT-099.
 *
 * Discard here reverts *that one element* to the saved version, not the whole
 * draft: the question named one element, so it may only take one.
 */
import { useState } from "react";

import { UnsavedGuardDialog } from "@/components/dialogs/unsaved-guard-dialog";
import { getCatalogEntryAt } from "@/lib/catalog";
import { selectDirtyVmIdCount, selectGuardOpen, useEditorStore } from "@/lib/store";

export function ElementSwitchGuard({
  currentVersionLabel,
  onSave,
}: {
  /** "v5": the version a discard leaves standing. */
  currentVersionLabel?: string;
  /**
   * The Save flow — `useSaveFlow`'s `requestSave`, from the shell. Absent
   * (`/dev`) leaves Save disabled and saying so, because nothing may fake a
   * save.
   */
  onSave?: () => void | Promise<void>;
}) {
  const open = useEditorStore(selectGuardOpen);
  const resolveGuard = useEditorStore((state) => state.resolveGuard);
  // The element the guard was opened *about*, which is also the only one
  // Discard will revert — not whatever is selected by the time it is answered.
  const vmId = useEditorStore((state) => state.guardedVmId);
  const unsavedElementCount = useEditorStore(selectDirtyVmIdCount);
  // Scalars, not objects: a selector that built one would hand Zustand a fresh
  // snapshot on every render.
  const tag = useEditorStore((state) => (vmId === null ? undefined : state.elements[vmId]?.tag));
  const assignment = useEditorStore((state) =>
    vmId === null ? undefined : state.draftState[vmId],
  );
  const [saving, setSaving] = useState(false);

  // `UnsavedGuardDialog` documents the invariant that a *named* question only
  // describes what Discard would take. Discard takes one element, so the name
  // may only appear while that element's changes are all there are — otherwise
  // "…or discard to leave v5 as is" is simply false. Unreachable in Phase 4,
  // where at most one element is dirty at a time; Phase 5's page-level
  // auto-generate is the exception spec §5 names.
  const namesTheOnlyChange = vmId !== null && unsavedElementCount === 1;
  const animationName =
    namesTheOnlyChange && assignment
      ? (getCatalogEntryAt(assignment.catalogVersion, assignment.animationId)?.name ??
        assignment.animationId)
      : undefined;

  // The tag the bridge reported ("h1") reads as the handoff's question; the
  // vmId is the honest fallback before any `element:select` has arrived.
  const elementLabel = namesTheOnlyChange ? (tag ?? vmId ?? undefined) : undefined;

  const handleSave = onSave
    ? () => {
        if (saving) return;
        setSaving(true);
        // Only after the save has actually happened: a failed save that moved
        // the selection anyway would lose the work it was asked to keep.
        void Promise.resolve(onSave()).then(
          () => {
            setSaving(false);
            resolveGuard("saved");
          },
          () => {
            setSaving(false);
          },
        );
      }
    : undefined;

  return (
    <UnsavedGuardDialog
      open={open}
      elementLabel={elementLabel}
      animationName={animationName}
      unsavedElementCount={unsavedElementCount}
      currentVersionLabel={currentVersionLabel}
      onDiscard={() => resolveGuard("discard")}
      onKeepEditing={() => resolveGuard("keep")}
      onSave={handleSave}
      // Not also `|| saving`: `saveDisabled` is what prints the "Saving isn't
      // available here" note, which would be a lie mid-save. A second click is
      // refused by the handler instead.
      saveDisabled={handleSave === undefined}
    />
  );
}
