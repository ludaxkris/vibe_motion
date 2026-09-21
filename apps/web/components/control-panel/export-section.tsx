"use client";

import {
  HISTORY_LOAD_FAILED,
  type VersionHistory,
} from "@/components/history/use-version-history";
import { ExportTab } from "@/components/export/export-tab";
import { Button } from "@/components/ui/button";
import type { EditorStateMap } from "@/lib/api-client";
import { selectSelectedVmId, useEditorStore } from "@/lib/store";
import { useVersionState } from "@/lib/versions/queries";

import { PanelCard, PanelSection, PanelSpinner } from "./panel-card";

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
  const version = history.versions.find((candidate) => candidate.id === versionId);
  // Not while the panel is about to decline to name a version: with the list
  // failed or still coming, a `/state` request is made behind an error screen
  // for a version this render will not show.
  const wanted = version !== undefined && !fromStore ? versionId : null;
  const stateQuery = useVersionState(projectId, wanted);
  const state: EditorStateMap | undefined = fromStore ? storeState : stateQuery.data;

  if (versionId === null || version === undefined) {
    // Which of the three is true matters: the list is still coming, the list
    // could not be fetched at all, or — the case v0 makes almost impossible —
    // the project really has no version. Saying the last one for the second
    // would be a false statement about the project rather than about a request.
    if (history.pending) {
      return (
        <PanelCard data-testid="panel-export-pending">
          <PanelSection>
            <PanelSpinner label="Loading versions" />
          </PanelSection>
        </PanelCard>
      );
    }
    if (history.listError) {
      return (
        <PanelCard data-testid="panel-export-list-error">
          <PanelSection>
            {/* The History tab's message and action, deliberately: it is the
                same failed request, and a second wording for it would only
                make the reader wonder whether it is a second problem. */}
            <p role="alert" className="text-sm leading-body text-vm-danger">
              {HISTORY_LOAD_FAILED}
            </p>
            <Button variant="secondary" size="sm" className="self-start" onClick={history.retry}>
              Retry
            </Button>
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
      // The export is the API's work and is unaffected by this failure; what
      // is lost is the footer's counts and the ability to offer a snippet, and
      // the panel says exactly that rather than showing zeroes or a hint that
      // asks the reader to select the element they already selected.
      stateError={stateQuery.isError ? { onRetry: () => void stateQuery.refetch() } : undefined}
      projectSlug={projectTitle}
    />
  );
}
