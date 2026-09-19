"use client"

import { Radio } from "@base-ui/react/radio"
import { RadioGroup } from "@base-ui/react/radio-group"
import { cn } from "cn"

/**
 * Two to four mutually exclusive options — trigger, repeat, export mode
 * (docs/design/design-system/components/core/Segmented.{jsx,prompt.md}).
 *
 * Built on Base UI's `RadioGroup`, so it is a real radio group: arrow keys
 * move the selection, each segment has an accessible name, and the whole
 * control takes one tab stop. The handoff's `<span onClick>` has none of that.
 */
export function Segmented({
  options,
  value,
  onValueChange,
  dense,
  disabled,
  className,
  ...props
}: Omit<RadioGroup.Props, "value" | "onValueChange"> & {
  options: readonly {
    value: string
    label: string
    /**
     * What the segment is called when the label alone does not say it — the
     * Repeat row's ∞ is a picture, and "Infinite" is the word for it.
     */
    ariaLabel?: string
  }[]
  value: string
  onValueChange?: (value: string) => void
  /** The Repeat row (1 / 2 / 3 / ∞) sits in a tighter box. */
  dense?: boolean
}) {
  return (
    <RadioGroup
      data-slot="segmented"
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onValueChange?.(next)
      }}
      disabled={disabled}
      className={cn(
        "flex rounded-md bg-vm-surface-muted p-0.5 data-disabled:pointer-events-none data-disabled:opacity-40",
        className
      )}
      {...props}
    >
      {options.map((option) => (
        <Radio.Root
          key={option.value}
          value={option.value}
          aria-label={option.ariaLabel}
          // Segments share the row's width, so a long label can still be cut
          // short by its box; the native tooltip is how it stays readable.
          title={option.ariaLabel ?? option.label}
          className={cn(
            "flex-1 rounded-sm text-center text-sm font-normal text-vm-ink-2 select-none",
            "transition-colors duration-(--dur-fast) ease-standard",
            "hover:text-vm-ink",
            "data-checked:bg-vm-surface data-checked:font-medium data-checked:text-vm-accent-strong data-checked:shadow-raised",
            dense ? "py-1" : "py-1.5"
          )}
        >
          {option.label}
        </Radio.Root>
      ))}
    </RadioGroup>
  )
}
