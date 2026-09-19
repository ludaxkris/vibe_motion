"use client";

import { Button } from "@/components/ui/button";
import { ElementTag } from "@/components/ui/element-tag";
import type { Trigger } from "@/lib/api-client";

import { PanelBackButton } from "./panel-back-button";
import { PanelCard, PanelSection } from "./panel-card";
import { rowMeta } from "./row-meta";

/** One element of the last auto-generate run that still has a draft assignment. */
export type AutoResultRow = {
  vmId: string;
  tag: string;
  animationName: string;
  trigger: Trigger;
  duration: string;
  delay: string;
  /** The designer has tuned it since: it is no longer the agent's to re-roll. */
  edited: boolean;
};

export type AutoResultProps = {
  rows: AutoResultRow[];
  prompt: string;
  skippedCount: number;
  truncated: boolean;
  /** The `limit` the elements query actually ran with; quoted when `truncated`. */
  consideredLimit: number;
  onSelectRow(vmId: string): void;
  onRegenerate(): void;
  onReplayAll(): void;
  onRemoveAll(): void;
  onClose(): void;
  replayDisabled?: boolean;
  regenerateDisabled?: boolean;
  removeAllDisabled?: boolean;
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The auto-generate result list (`docs/design/README.md` "2. Editor",
 * auto-generate result; mock frame `2k`): what the agent assigned, one row per
 * element, each a way into tuning it.
 *
 * Two departures from the mock, both decided in the Phase 5 plan (D3): rows
 * are never grouped (`.plan ×3`) because the bridge reports no class list, and
 * a row the designer has tuned stays in the list with a quiet "edited" tag
 * rather than vanishing. "‹" is the way out to idle — Esc deliberately is not.
 *
 * With no rows left (every generated animation removed by hand) the list gives
 * way to one line saying so; Regenerate and "‹" stay.
 *
 * Presentational and store-free: the `ControlPanel` container derives the rows
 * and supplies the callbacks, so `/dev` renders this from props alone.
 */
export function AutoResultPanel({
  rows,
  prompt,
  skippedCount,
  truncated,
  consideredLimit,
  onSelectRow,
  onRegenerate,
  onReplayAll,
  onRemoveAll,
  onClose,
  replayDisabled = false,
  regenerateDisabled = false,
  removeAllDisabled = false,
}: AutoResultProps) {
  const quotedPrompt = prompt.trim();

  return (
    <PanelCard data-testid="panel-auto-result">
      <PanelSection className="gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <PanelBackButton onClick={onClose} />
          <span
            data-testid="auto-result-title"
            className="min-w-0 flex-1 truncate text-md font-semibold"
          >
            <span aria-hidden="true" className="text-vm-accent">
              ✦
            </span>{" "}
            Generated {plural(rows.length, "animation")}
          </span>
          <Button
            variant="link"
            className="text-sm"
            disabled={regenerateDisabled}
            onClick={onRegenerate}
          >
            Regenerate
          </Button>
        </div>
        {quotedPrompt ? (
          <p
            data-testid="auto-result-prompt"
            className="text-sm leading-body break-words text-vm-ink-2"
          >
            &ldquo;{quotedPrompt}&rdquo;
          </p>
        ) : null}
      </PanelSection>

      {rows.length === 0 ? (
        <PanelSection>
          <p className="text-sm leading-body text-vm-ink-2">No generated animations left.</p>
        </PanelSection>
      ) : (
        <>
          <PanelSection className="gap-0 p-0">
            <ul className="flex flex-col">
              {rows.map((row) => (
                <li key={row.vmId} className="border-b border-vm-divider">
                  <button
                    type="button"
                    data-testid="auto-result-row"
                    // The tag alone cannot tell three <p> rows apart, and the
                    // vmId is what the click actually selects.
                    aria-label={`Tune ${row.animationName} on ${row.tag} (${row.vmId})`}
                    onClick={() => onSelectRow(row.vmId)}
                    className="flex w-full items-center gap-2.5 px-3.5 py-[11px] text-left transition-colors duration-(--dur-fast) ease-standard outline-none hover:bg-vm-panel focus-visible:bg-vm-panel"
                  >
                    <ElementTag tone="muted" size="sm" className="min-w-[58px] text-center">
                      {row.tag}
                    </ElementTag>
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-md font-medium">{row.animationName}</span>
                      <span
                        data-testid="auto-result-row-meta"
                        className="truncate text-xs text-vm-ink-2"
                      >
                        {rowMeta(row)}
                      </span>
                    </span>
                    {row.edited ? (
                      <span className="shrink-0 text-xs text-vm-ink-3">edited</span>
                    ) : null}
                    <span aria-hidden="true" className="shrink-0 text-vm-ink-3">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p
              data-testid="auto-result-caption"
              className="px-3.5 py-2.5 text-xs leading-body text-vm-ink-3"
            >
              Click a row to tune it, or click the element on the page.
              {skippedCount > 0
                ? ` Skipped ${plural(skippedCount, "element")} (too small, hidden or not content).`
                : null}
              {truncated ? ` Only the first ${consideredLimit} elements were considered.` : null}
            </p>
          </PanelSection>

          <PanelSection className="flex-row items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              glyph="↻"
              glyphTone="ink"
              disabled={replayDisabled}
              onClick={onReplayAll}
            >
              Replay all
            </Button>
            <Button
              variant="danger-link"
              className="ml-auto"
              disabled={removeAllDisabled}
              onClick={onRemoveAll}
            >
              Remove all
            </Button>
          </PanelSection>
        </>
      )}
    </PanelCard>
  );
}
