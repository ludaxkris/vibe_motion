"use client";

import { Button } from "@/components/ui/button";
import { ElementTag } from "@/components/ui/element-tag";
import { SectionLabel } from "@/components/ui/section-label";
import type { RunFailure } from "@/lib/agent/run";

import { AgentRunError } from "./agent-run-error";
import { PanelBackButton } from "./panel-back-button";
import { PanelCard, PanelSection } from "./panel-card";

/**
 * An element is selected but has no animation yet (`docs/design/README.md`
 * "2. Editor", selected).
 *
 * Presentational: the store-connected `ControlPanel` supplies the callbacks.
 */
export function SelectedPanel({
  vmId,
  elementText,
  onChooseCustom,
  onBack,
  onGenerate,
  busy = false,
  error,
}: {
  /** `data-vm-id` of the selected element — its tag until the bridge sends a nicer one (Phase 4). */
  vmId: string;
  /** The element's own text, once the bridge reports it (Phase 4). */
  elementText?: string;
  onChooseCustom?: () => void;
  /**
   * "‹", up one level. Rendered only when passed: there is somewhere to go
   * back to only when the element was opened from the auto-generate result list.
   */
  onBack?: () => void;
  /** Ask the agent for this element. Absent (button disabled) until the bridge is ready. */
  onGenerate?: () => void;
  /** An agent run is in flight: the button says so and takes no clicks. */
  busy?: boolean;
  /** Why the last run did nothing (plan D10). */
  error?: RunFailure | null;
}) {
  return (
    <PanelCard data-testid="panel-selected">
      <PanelSection className="gap-2">
        <SectionLabel>Selected</SectionLabel>
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <PanelBackButton onClick={onBack} />
          ) : null}
          <ElementTag>{vmId}</ElementTag>
          {elementText ? (
            <span className="min-w-0 truncate text-sm text-vm-ink-2">{elementText}</span>
          ) : null}
        </div>
        {/* Opened from the result list, Esc (DESELECT) lands back on the list,
            not on idle — the hint has to say what the key does here. */}
        <p className="text-xs text-vm-ink-3">
          {onBack
            ? "No animation yet · Esc returns to the list"
            : "No animation yet · Esc to deselect"}
        </p>
      </PanelSection>

      <PanelSection className="gap-2">
        <SectionLabel>Add animation</SectionLabel>
        <Button
          size="lg"
          glyph="✦"
          disabled={!onGenerate || busy}
          aria-busy={busy || undefined}
          onClick={onGenerate}
        >
          {busy ? "Generating…" : "Auto-generate for this element"}
        </Button>
        <AgentRunError error={error} busy={busy} />
        <Button variant="secondary" size="lg" onClick={onChooseCustom}>
          Choose custom animation
        </Button>
      </PanelSection>
    </PanelCard>
  );
}
