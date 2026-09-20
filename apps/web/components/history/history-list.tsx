import type { Version } from "@/lib/api-client";
import { getCatalogEntryAt } from "@/lib/catalog";
import type { CatalogLookup } from "@/lib/diff-summary";
import { summariseDiff } from "@/lib/diff-summary";
import { statesBySeq } from "@/lib/versions/diff";

import type { VersionRowProps } from "./version-row";
import { VersionRow } from "./version-row";

export type HistoryListProps = {
  versions: Version[];
  currentVersionId: string;
  viewingVersionId: string | null;
  now: Date;
  /** v0 only: how many elements the clone found. */
  elementCount?: number;
} & Pick<VersionRowProps, "onView" | "onRestore" | "onExport" | "restoring">;

/** `getCatalogEntryAt`'s shape already satisfies `CatalogLookupEntry`; this just names the fit. */
const lookup: CatalogLookup = (catalogVersion, id) => getCatalogEntryAt(catalogVersion, id);

/** "v1 and v2", "v1, v2 and v3" — the versions a restore leaves standing. */
function joinLabels(versions: readonly Version[]): string {
  const labels = versions.map((version) => `v${version.seq}`);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/**
 * The History tab's list: every version, newest first, each expanding on
 * click into its own diff (`docs/design/README.md` "History tab").
 *
 * Rows are computed once here via `statesBySeq` + `summariseDiff`, so every
 * row's names resolve against the catalog version *that version* pinned,
 * never the current catalog (CLAUDE.md rule 9).
 */
export function HistoryList({
  versions,
  currentVersionId,
  viewingVersionId,
  now,
  elementCount,
  onView,
  onRestore,
  onExport,
  restoring,
}: HistoryListProps) {
  const ascending = [...versions].sort((a, b) => a.seq - b.seq);
  const states = statesBySeq(ascending);

  const viewedIndex = ascending.findIndex((version) => version.id === viewingVersionId);
  const viewedVersion = viewedIndex >= 0 ? ascending[viewedIndex] : null;
  const versionsAfterViewed = viewedVersion
    ? ascending.filter((version) => version.seq > viewedVersion.seq)
    : [];

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">
        {ascending
          .map((version, index) => {
            const parentState = index === 0 ? {} : states[index - 1];
            const rows = summariseDiff(parentState, states[index], lookup).rows;
            return (
              <VersionRow
                key={version.id}
                version={version}
                rows={rows}
                isCurrent={version.id === currentVersionId}
                isViewing={version.id === viewingVersionId}
                now={now}
                elementCount={version.seq === 0 ? elementCount : undefined}
                onView={onView}
                onRestore={onRestore}
                onExport={onExport}
                restoring={restoring}
              />
            );
          })
          .reverse()}
      </ul>

      {viewedVersion && versionsAfterViewed.length > 0 ? (
        <p className="px-3.5 py-2.5 text-xs leading-body text-vm-ink-2">
          Restoring creates a new version — {joinLabels(versionsAfterViewed)}{" "}
          {versionsAfterViewed.length === 1 ? "stays" : "stay"} in the list.
        </p>
      ) : null}
    </div>
  );
}
