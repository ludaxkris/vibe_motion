"use client";

import { cn } from "cn";

import { ChangeRow } from "@/components/dialogs/save-dialog";
import { Button } from "@/components/ui/button";
import type { Version } from "@/lib/api-client";
import type { DiffRow } from "@/lib/diff-summary";
import { relativeTime } from "@/lib/versions/relative-time";

export type VersionRowProps = {
  version: Version;
  /** This version's own change rows, from `summariseDiff(parentState, state, getCatalogEntryAt)`. */
  rows: DiffRow[];
  isCurrent: boolean;
  isViewing: boolean;
  now: Date;
  /** v0 only: how many elements the clone found. */
  elementCount?: number;
  onView: (versionId: string) => void;
  onRestore: (versionId: string) => void;
  /** Export stays disabled until Phase 7 wires a handler in. */
  onExport?: (versionId: string) => void;
  restoring?: boolean;
};

/** "Current · 2h ago", or "Mon · 42 elements" for v0 (`docs/design/README.md` "History tab"). */
function meta(version: Version, isCurrent: boolean, now: Date, elementCount?: number): string {
  const when = relativeTime(version.createdAt, now);
  const base = isCurrent ? `Current · ${when}` : when;
  if (version.seq === 0 && elementCount !== undefined) return `${base} · ${elementCount} elements`;
  return base;
}

/**
 * One row of the History tab: `v5`, its label and timestamp, expanding on
 * click into the version's own diff plus Restore / Export
 * (`docs/design/design-system/components/core/VersionRow.jsx`).
 *
 * Presentational: `onView`/`onRestore`/`onExport` are the only way out.
 */
export function VersionRow({
  version,
  rows,
  isCurrent,
  isViewing,
  now,
  elementCount,
  onView,
  onRestore,
  onExport,
  restoring = false,
}: VersionRowProps) {
  const label = `v${version.seq}`;

  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 border-b border-vm-divider border-l-[3px] py-3 pr-4 pl-3.5 last:border-b-0",
        isViewing ? "border-l-vm-accent bg-vm-accent-tint" : "border-l-transparent",
        !isViewing && isCurrent ? "bg-vm-panel" : undefined,
      )}
    >
      <button
        type="button"
        onClick={() => onView(version.id)}
        aria-expanded={isViewing}
        className="flex items-start gap-2.5 text-left"
      >
        <span
          className={cn(
            "w-6 shrink-0 pt-px font-mono text-sm font-semibold",
            isViewing ? "text-vm-accent" : isCurrent ? "text-vm-ink" : "text-vm-ink-2",
          )}
        >
          {label}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{version.label}</span>
            {isCurrent ? (
              <span className="shrink-0 rounded-sm bg-vm-surface-muted px-1.5 py-0.5 text-xs font-medium text-vm-ink-2">
                Current
              </span>
            ) : null}
          </div>
          <span className="text-xs text-vm-ink-2">{meta(version, isCurrent, now, elementCount)}</span>
        </div>
      </button>

      {isViewing ? (
        <div className="ml-[34px] flex flex-col gap-2.5">
          {rows.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {rows.map((row) => (
                <ChangeRow key={`${row.kind}-${row.vmId}`} row={row} />
              ))}
            </ul>
          ) : null}
          <div className="flex items-center gap-2">
            {!isCurrent ? (
              <Button size="sm" disabled={restoring} onClick={() => onRestore(version.id)}>
                Restore
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={!onExport}
              onClick={() => onExport?.(version.id)}
            >
              Export {label}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
