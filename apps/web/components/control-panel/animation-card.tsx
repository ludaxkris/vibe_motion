"use client";

import { cn } from "cn";
import { useState, type CSSProperties, type Ref } from "react";

import type { CatalogEntry } from "@/lib/api-client";
import { catalogInlineStyle } from "@/lib/catalog";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

/**
 * One card in the picker's 2-column grid
 * (`docs/design/design-system/components/core/AnimationCard.jsx`): a 16:10
 * demo box with a violet block, and the animation's name.
 *
 * Hovering or focusing plays the entry's *real* keyframes on the block — the
 * same CSS the export ships — so the card is never a hand-drawn impression of
 * the animation. The `@keyframes` themselves are injected once by the picker
 * (`ChoosingPanel`) for every visible entry; this only sets the
 * `animation-*` properties.
 *
 * The same hover also previews the animation on the *page*, transiently and
 * without touching the draft (spec D4) — that is `onPreviewStart` /
 * `onPreviewEnd`, which the picker turns into `preview` / `preview:clear`.
 * Reduced motion stills the local demo but not the page preview: spec §6a is
 * explicit that the editor preview always plays, and a designer who asked for
 * a preview asked for it.
 */
export function AnimationCard({
  entry,
  catalogVersion,
  applied = false,
  onApply,
  onPreviewStart,
  onPreviewEnd,
  ref,
}: {
  entry: CatalogEntry;
  /** The version the demo (and any resulting assignment) is pinned to. */
  catalogVersion: string;
  /** This is the animation currently on the selected element. */
  applied?: boolean;
  onApply?: () => void;
  /** Show this entry on the selected element in the preview iframe. */
  onPreviewStart?: () => void;
  /** Take it away again. */
  onPreviewEnd?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const [playing, setPlaying] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // Reduced motion stops the demo, never the picking: Enter still applies.
  const demoStyle = playing && !reducedMotion ? catalogInlineStyle(entry, catalogVersion) : undefined;
  const highlighted = playing || applied;

  const enter = () => {
    setPlaying(true);
    onPreviewStart?.();
  };
  const leave = () => {
    setPlaying(false);
    onPreviewEnd?.();
  };

  return (
    <button
      ref={ref}
      type="button"
      data-slot="animation-card"
      data-testid="animation-card"
      aria-current={applied ? "true" : undefined}
      onClick={onApply}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-2 text-left",
        "bg-vm-surface transition-[border-color,box-shadow] duration-(--dur-fast) ease-standard",
        highlighted
          ? "border-[1.5px] border-vm-accent shadow-focus-ring"
          : "border-vm-border hover:border-vm-accent",
      )}
    >
      <span
        className={cn(
          "flex aspect-[16/10] items-center justify-center overflow-hidden rounded-sm",
          highlighted ? "bg-vm-accent-tint" : "bg-vm-panel",
        )}
      >
        <span
          data-testid="animation-card-demo"
          className="block h-[18px] w-[30px] rounded-xs bg-vm-accent"
          style={demoStyle as CSSProperties | undefined}
        />
      </span>
      <span className="truncate text-sm font-medium">{entry.name}</span>
    </button>
  );
}
