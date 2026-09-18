import * as React from "react"
import { cn } from "cn"

/**
 * The one place the handoff breaks sentence case: 11px semibold uppercase with
 * 0.04em tracking ("TRIGGER", "SELECTED"). Takes an `id` so the section it
 * heads can point `aria-labelledby` at it.
 */
export function SectionLabel({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="section-label"
      className={cn(
        "text-xs font-semibold tracking-label text-vm-ink-2 uppercase",
        className
      )}
      {...props}
    />
  )
}
