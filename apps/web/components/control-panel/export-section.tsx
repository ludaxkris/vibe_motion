"use client";

import type { VersionHistory } from "@/components/history/use-version-history";
import { ExportTab } from "@/components/export/export-tab";
import type { EditorStateMap } from "@/lib/api-client";
import { selectSelectedVmId, useEditorStore } from "@/lib/store";
import { useVersionState } from "@/lib/versions/queries";

import { PanelCard, PanelSection } from "./panel-card";

/** No version to export: only reachable when the list failed or came back empty. */
export const NO_VERSION = "No saved version to export yet.";

/**
 * The Export tab, connected.
 *
 * Mounted by `ControlPanel` inside the Export `TabsContent`, which Base UI only
 * renders while that tab is open (`Tabs.Panel` is `keepMounted: false`). That is
 * deliberate on two counts: the store reads below must not re-render the panel
 * on a slider tick (DT-126, `render-cost.test.tsx`), and the export request must
 * not be issued behind the Animate tab.
 *
 * ## Which version, and which state
 *
 * `exportVersionId` is the version the reader pinned — by opening Export while
 * viewing it, or from a History row's "Export vN" — and null means the project's
 * current version (plan §5.2).
 *
 * The *state* that version materialises to is what the footer counts and what
 * decides whether Snippet is offered, and it comes from the cheapest true
 * source: the store, when the store's `currentVersionId` is the version being
 * exported, and Phase 6's `/versions/{id}/state` query otherwise (already in the
 * cache whenever the reader came from viewing that version).
 *
 * Never `draftState`: unsaved work is not in any version, so a snippet offered
 * for a draft-only assignment would be a 404 from the API, and the footer would
 * count elements the download does not contain.
 */
export function ExportSection({
  projectId,
  projectTitle,
  history,
  exportVersionId,
}: {
  projectId: string;
  /** Only the download's file name ever sees it. */
  projectTitle?: string;
  history: VersionHistory;
  /** The version pinned by the switch into this tab; null means the current one. */
  exportVersionId: string | null;
}) {
  const selectedVmId = useEditorStore(selectSelectedVmId);
  // Both change only when a version is saved, loaded or restored — never on a
  // draft edit.
  const storeVersionId = useEditorStore((state) => state.currentVersionId);
  const storeState = useEditorStore((state) => state.currentVersionState);

  const versionId = exportVersionId ?? history.currentVersionId;
  const fromStore = versionId !== null && versionId === storeVersionId;
  const stateQuery = useVersionState(projectId, fromStore ? null : versionId);
  const state: EditorStateMap | undefined = fromStore ? storeState : stateQuery.data;

  const version = history.versions.find((candidate) => candidate.id === versionId);

  if (versionId === null || version === undefined) {
    // v0 exists from the clone, so there is always something to export once the
    // list lands. Until it does, this is the list's own state, not the export's.
    if (history.pending) {
      return (
        <PanelCard data-testid="panel-export-pending">
          <PanelSection>
            <div role="status" aria-label="Loading history" className="flex justify-center py-2">
              <div className="size-5 animate-spin rounded-full border-2 border-vm-border border-t-vm-accent" />
            </div>
          </PanelSection>
        </PanelCard>
      );
    }
    return (
      <PanelCard data-testid="panel-export-empty">
        <PanelSection>
          <p className="text-sm leading-body text-vm-ink-2">{NO_VERSION}</p>
        </PanelSection>
      </PanelCard>
    );
  }

  return (
    <ExportTab
      projectId={projectId}
      versionId={versionId}
      versionSeq={version.seq}
      isCurrent={versionId === history.currentVersionId}
      selectedVmId={selectedVmId}
      state={state}
      projectSlug={projectTitle}
    />
  );
}
