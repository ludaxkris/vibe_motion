"use client"

import { Toggle } from "@base-ui/react/toggle"
import { cn } from "cn"

/**
 * Pill filter chip for catalog categories and the help page
 * (docs/design/design-system/components/core/Chip.{jsx,prompt.md}). Selected is
 * an ink fill, unselected a hairline.
 *
 * A Base UI `Toggle`, so the selected state is `aria-pressed` rather than
 * colour alone; the caller keeps "exactly one selected" (a chip row is a
 * filter, not a radio group — the handoff's rows re-select rather than clear).
 */
export function Chip({ className, ...props }: Toggle.Props) {
  return (
    <Toggle
      data-slot="chip"
      className={cn(
        "inline-flex shrink-0 items-center rounded-pill border border-vm-border-strong px-2.5 py-1",
        "text-sm font-normal whitespace-nowrap text-vm-ink select-none",
        "transition-colors duration-(--dur-fast) ease-standard",
        "hover:bg-vm-surface-muted",
        "data-pressed:border-vm-ink data-pressed:bg-vm-ink data-pressed:font-medium data-pressed:text-vm-ink-inverse data-pressed:hover:bg-vm-ink",
        "data-disabled:pointer-events-none data-disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
}
