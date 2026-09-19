"use client";

import { Button } from "@/components/ui/button";
import { ElementTag } from "@/components/ui/element-tag";
import { SectionLabel } from "@/components/ui/section-label";

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
}) {
  return (
    <PanelCard data-testid="panel-selected">
      <PanelSection className="gap-2">
        <SectionLabel>Selected</SectionLabel>
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Back"
              glyph="‹"
              onClick={onBack}
              className="-ml-1.5 text-lg"
            />
          ) : null}
          <ElementTag>{vmId}</ElementTag>
          {elementText ? (
            <span className="min-w-0 truncate text-sm text-vm-ink-2">{elementText}</span>
          ) : null}
        </div>
        <p className="text-xs text-vm-ink-3">No animation yet · Esc to deselect</p>
      </PanelSection>

      <PanelSection className="gap-2">
        <SectionLabel>Add animation</SectionLabel>
        {/* The mock agent (Phase 5) is what fills this in. */}
        <Button size="lg" glyph="✦" disabled>
          Auto-generate for this element
        </Button>
        <Button variant="secondary" size="lg" onClick={onChooseCustom}>
          Choose custom animation
        </Button>
      </PanelSection>
    </PanelCard>
  );
}
