"use client";

import { useId } from "react";

import { Button } from "@/components/ui/button";
import { ElementTag } from "@/components/ui/element-tag";
import { SectionLabel } from "@/components/ui/section-label";
import type { Assignment, EditorStateMap } from "@/lib/api-client";
import { getCatalogEntryAt } from "@/lib/catalog";

import { PanelCard, PanelSection } from "./panel-card";
import { rowMeta } from "./row-meta";

function assignmentMeta(assignment: Assignment): string {
  return rowMeta({
    trigger: assignment.trigger,
    duration: assignment.params.duration,
    delay: assignment.params.delay,
  });
}

/**
 * Resolved against the version the assignment pinned, never the current one:
 * a row must read as what it actually is (CLAUDE.md rule 9).
 */
function animationName(assignment: Assignment): string {
  return (
    getCatalogEntryAt(assignment.catalogVersion, assignment.animationId)?.name ??
    assignment.animationId
  );
}

/**
 * Nothing selected (`docs/design/README.md` "2. Editor", idle): the invitation
 * to click an element, the whole-page prompt, and — once anything is animated
 * — the list of what is.
 *
 * Presentational: the store-connected `ControlPanel` passes the draft in and
 * the selection callback back out, so `/dev` (Task 9) can render this state
 * from props alone.
 */
export function IdlePanel({
  assignments,
  onSelectElement,
}: {
  /** The draft, `vmId -> Assignment`. */
  assignments: EditorStateMap;
  /** Clicking an animated row selects that element. */
  onSelectElement?: (vmId: string) => void;
}) {
  const promptId = useId();
  const entries = Object.entries(assignments);

  return (
    <PanelCard data-testid="panel-idle">
      <PanelSection className="items-center gap-2 py-5 text-center">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-md border border-dashed border-vm-border-strong text-lg text-vm-accent"
        >
          +
        </span>
        <p className="text-md font-semibold">Click any element to animate it</p>
        <p className="text-sm leading-body text-vm-ink-2">
          Hover outlines the element. Press{" "}
          <kbd className="rounded-xs bg-vm-surface-muted px-1 py-0.5 font-mono text-xs text-vm-ink">
            Esc
          </kbd>{" "}
          to deselect.
        </p>
      </PanelSection>

      <PanelSection>
        <SectionLabel>Whole page</SectionLabel>
        <label htmlFor={promptId} className="sr-only">
          Describe the feel
        </label>
        <textarea
          id={promptId}
          rows={3}
          placeholder="Describe the feel — 'calm, staggered entrances, nothing loops'"
          className="min-h-14 w-full resize-y rounded-md border border-vm-border-strong bg-vm-surface p-2 text-md leading-ui text-vm-ink transition-[border-color,box-shadow] duration-(--dur-fast) ease-standard outline-none placeholder:text-vm-ink-3 focus-visible:border-vm-accent"
        />
        <Button variant="secondary" size="lg" glyph="✦" disabled>
          Auto-generate for this page
        </Button>
        <p className="text-xs leading-body text-vm-ink-2">
          Auto-generate arrives with the mock agent. For now, click an element and choose an
          animation.
        </p>
      </PanelSection>

      {entries.length > 0 ? (
        <PanelSection>
          <SectionLabel>Animated · {entries.length}</SectionLabel>
          <ul className="flex flex-col gap-1">
            {entries.map(([vmId, assignment]) => (
              <li key={vmId}>
                <button
                  type="button"
                  onClick={() => onSelectElement?.(vmId)}
                  aria-label={`Tune ${animationName(assignment)} on ${vmId}`}
                  className="flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left transition-colors duration-(--dur-fast) ease-standard hover:bg-vm-panel"
                >
                  <ElementTag tone="muted" size="sm" className="w-[52px] truncate">
                    {vmId}
                  </ElementTag>
                  <span className="min-w-0 flex-1 truncate text-md font-medium">
                    {animationName(assignment)}
                  </span>
                  <span className="shrink-0 text-xs text-vm-ink-2">
                    {assignmentMeta(assignment)}
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-vm-ink-3">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {/* Replaying needs the bridge to re-trigger the animation in the
              iframe (Phase 4); there is nothing honest for it to do yet. */}
          <Button
            variant="secondary"
            size="sm"
            glyph="↻"
            glyphTone="ink"
            disabled
            className="self-start"
          >
            Replay all
          </Button>
        </PanelSection>
      ) : null}
    </PanelCard>
  );
}
