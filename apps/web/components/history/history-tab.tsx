"use client";

/**
 * The Control Panel's History tab: `HistoryList` over
 * `useVersionHistory` (`docs/design/README.md` "History tab").
 *
 * Three states, in the same shape as the editor's project-load error: the
 * list in flight, a list that could not be loaded (with the one action that
 * can fix it), and the list itself. A view or a restore that failed is an
 * inline message above the rows — the list is still good, and the row the
 * reader clicked is still where they left it.
 *
 * `now` is captured here rather than inside `HistoryList` or `VersionRow`:
 * those are pure, and "2h ago" must not be a fresh `new Date()` on every
 * render of a list that re-renders on every store change.
 */
import { useEffect, useState } from "react";

import { PanelCard, PanelSection } from "@/components/control-panel/panel-card";
import { Button } from "@/components/ui/button";

import { HistoryList } from "./history-list";
import { HISTORY_LOAD_FAILED, type VersionHistory } from "./use-version-history";

/** Long enough that "2h ago" is never wrong for more than a minute. */
const TICK_MS = 60_000;

/** One clock for the whole list, ticking only while the tab is open. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function HistoryTab({ history }: { history: VersionHistory }) {
  const now = useNow();

  if (history.pending) {
    return (
      <PanelCard>
        <PanelSection>
          <div role="status" aria-label="Loading history" className="flex justify-center py-2">
            <div className="size-5 animate-spin rounded-full border-2 border-vm-border border-t-vm-accent" />
          </div>
        </PanelSection>
      </PanelCard>
    );
  }

  if (history.listError) {
    return (
      <PanelCard>
        <PanelSection>
          <p className="text-sm leading-body text-vm-danger">{HISTORY_LOAD_FAILED}</p>
          <Button variant="secondary" size="sm" className="self-start" onClick={history.retry}>
            Retry
          </Button>
        </PanelSection>
      </PanelCard>
    );
  }

  return (
    <PanelCard>
      {history.error ? (
        <PanelSection>
          <p role="alert" className="text-sm leading-body text-vm-danger">
            {history.error}
          </p>
        </PanelSection>
      ) : null}
      <HistoryList
        // A fresh array: the hook's list is readonly, and `HistoryList` sorts
        // its own copy anyway.
        versions={[...history.versions]}
        // "" rather than a guess when the project's open load failed: no row
        // is the current one then, which is the truth (`useProjectVersions`).
        currentVersionId={history.currentVersionId ?? ""}
        viewingVersionId={history.viewingVersionId}
        now={now}
        // No `elementCount`: nothing keeps the bridge's `ready.elementCount`
        // (DT to file), and v0's row reads fine without it.
        onView={history.view}
        onRestore={history.restore}
        // `onExport` stays absent, which is what disables Export: Phase 7.
        restoring={history.restoring}
      />
    </PanelCard>
  );
}
