import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The box is the wrapper, not the `<input>`: the handoff's field can carry a
// prefix ("https://" on the entry URL, "⌕" on search) inside the same border
// (docs/design/design-system/components/core/Input.jsx). `className` therefore
// lands on the wrapper, which is what callers size.
const inputVariants = cva(
  [
    "flex w-full min-w-0 items-center gap-2 border border-vm-border-strong bg-vm-surface",
    "text-vm-ink transition-[border-color,box-shadow] duration-fast ease-standard",
    "has-[input:focus-visible]:border-vm-accent has-[input:focus-visible]:focus-ring",
    // Error: 1.5px danger border + a 12% danger glow (handoff, Entry state 3b).
    "has-aria-invalid:border-[1.5px] has-aria-invalid:border-vm-danger",
    "has-aria-invalid:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-vm-danger)_12%,transparent)]",
    "has-[input:disabled]:pointer-events-none has-[input:disabled]:opacity-40",
  ],
  {
    variants: {
      size: {
        sm: "h-[34px] rounded-md px-2.5 text-md",
        md: "h-[38px] rounded-md px-2.5 text-md",
        xl: "h-[var(--control-h-xl)] rounded-lg px-3.5 text-[14px]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  }
)

function Input({
  className,
  type,
  size = "md",
  prefix,
  ...props
}: Omit<React.ComponentProps<"input">, "size" | "prefix"> &
  VariantProps<typeof inputVariants> & {
    /** Static affordance inside the border ("https://", "⌕"). Decorative. */
    prefix?: React.ReactNode
  }) {
  return (
    <div data-slot="input-wrapper" className={cn(inputVariants({ size }), className)}>
      {prefix == null ? null : (
        <span aria-hidden="true" data-slot="input-prefix" className="shrink-0 text-vm-ink-3">
          {prefix}
        </span>
      )}
      <InputPrimitive
        type={type}
        data-slot="input"
        className="min-w-0 flex-1 bg-transparent font-[inherit] text-[inherit] outline-none placeholder:text-vm-ink-3 disabled:cursor-not-allowed"
        {...props}
      />
    </div>
  )
}

export { Input, inputVariants }
