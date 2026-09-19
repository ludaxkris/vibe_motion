"use client";

import { Button } from "@/components/ui/button";
import { ElementTag } from "@/components/ui/element-tag";
import type { Trigger } from "@/lib/api-client";

import { PanelCard, PanelSection } from "./panel-card";

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
  onSelectRow(vmId: string): void;
  onRegenerate(): void;
  onReplayAll(): void;
  onRemoveAll(): void;
  onClose(): void;
  replayDisabled?: boolean;
};

/** Mirrors `ELEMENTS_QUERY_LIMIT` (phase-5 plan §3); copy only, nothing is clamped here. */
const CONSIDERED_LIMIT = 200;

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
 * Presentational and store-free: the `ControlPanel` container derives the rows
 * and supplies the callbacks, so `/dev` renders this from props alone.
 */
export function AutoResultPanel({
  rows,
  prompt,
  skippedCount,
  truncated,
  onSelectRow,
  onRegenerate,
  onReplayAll,
  onRemoveAll,
  onClose,
  replayDisabled = false,
}: AutoResultProps) {
  const quotedPrompt = prompt.trim();

  return (
    <PanelCard data-testid="panel-auto-result">
      <PanelSection className="gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Back"
            glyph="‹"
            onClick={onClose}
            className="-ml-1.5 text-lg"
          />
          <h2 className="min-w-0 flex-1 truncate text-md font-semibold">
            <span aria-hidden="true" className="text-vm-accent">
              ✦
            </span>{" "}
            Generated {plural(rows.length, "animation")}
          </h2>
          <Button variant="link" className="text-sm" onClick={onRegenerate}>
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

      <PanelSection className="gap-0 p-0">
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li key={row.vmId} className="border-b border-vm-divider">
              <button
                type="button"
                data-testid="auto-result-row"
                onClick={() => onSelectRow(row.vmId)}
                className="flex w-full items-center gap-2.5 px-3.5 py-[11px] text-left transition-colors duration-(--dur-fast) ease-standard outline-none hover:bg-vm-panel focus-visible:bg-vm-panel"
              >
                <ElementTag tone="muted" size="sm" className="w-[58px] truncate text-center">
                  {row.tag}
                </ElementTag>
                <span className="flex min-w-0 flex-1 flex-col gap-px">
                  <span className="truncate text-md font-medium">{row.animationName}</span>
                  <span className="truncate text-xs text-vm-ink-2">
                    {row.trigger} · {row.duration} · {row.delay}
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
          {truncated ? ` Only the first ${CONSIDERED_LIMIT} elements were considered.` : null}
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
        <Button variant="danger-link" className="ml-auto" onClick={onRemoveAll}>
          Remove all
        </Button>
      </PanelSection>
    </PanelCard>
  );
}
