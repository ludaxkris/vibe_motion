import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// docs/design/design-system/components/core/ElementTag.{jsx,prompt.md}: the
// mono identifier of a page element (h1, a.cta, .plan:2). Accent tone is
// reserved for the current selection; lists use the muted tone.
const elementTagVariants = cva(
  "inline-block shrink-0 font-mono font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        accent: "bg-vm-accent text-vm-ink-inverse",
        muted: "bg-vm-surface-muted text-vm-ink",
      },
      size: {
        // `leading-none` follows `text-*`: tailwind-merge treats a font-size
        // utility as resetting line-height (Tailwind 4 pairs them), so it
        // would drop an earlier `leading-*`. --type-mono is `500 12px/1`.
        sm: "rounded-[5px] px-1.5 py-0.5 text-xs leading-none",
        md: "rounded-sm px-2 py-[3px] text-sm leading-none",
      },
    },
    defaultVariants: {
      tone: "accent",
      size: "md",
    },
  }
)

export function ElementTag({
  className,
  tone,
  size,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof elementTagVariants>) {
  return (
    <span
      data-slot="element-tag"
      className={cn(elementTagVariants({ tone, size }), className)}
      {...props}
    />
  )
}

export { elementTagVariants }
