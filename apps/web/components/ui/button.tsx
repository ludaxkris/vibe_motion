import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// The handoff's seven variants (docs/design/design-system/components/core/
// Button.jsx + .prompt.md). Shared so the shadcn variant keys Tasks 3–5
// already call — `default`, `outline`, `secondary`, `destructive` — can alias
// them rather than drift into a second palette.
const PRIMARY =
  "bg-vm-accent text-vm-ink-inverse hover:bg-vm-accent-hover active:bg-vm-accent-pressed"
const SECONDARY =
  "border-vm-border-strong bg-vm-surface font-medium text-vm-ink hover:bg-vm-surface-muted"
const DANGER_LINK =
  "h-auto px-0 text-sm font-medium text-vm-danger hover:text-vm-danger hover:underline"

const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent bg-clip-padding px-3.5",
    "text-md font-semibold whitespace-nowrap select-none",
    // Chrome motion: 150ms, and nothing moves on press (handoff, "States").
    "transition-colors duration-(--dur-fast) ease-standard",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: PRIMARY,
        secondary: SECONDARY,
        ink: "bg-vm-ink text-vm-ink-inverse hover:bg-vm-ink/90",
        "bar-primary": "bg-vm-bar-accent text-vm-bar-ink hover:bg-vm-bar-accent/90",
        "bar-outline":
          "border-vm-bar-border font-medium text-vm-bar-ink hover:bg-vm-bar-ink/10",
        "danger-link": DANGER_LINK,
        link: "h-auto px-0 text-sm font-medium text-vm-accent hover:underline",
        ghost: "text-vm-ink-2 hover:bg-vm-surface-muted hover:text-vm-ink",
        // Back-compat aliases for the shadcn keys already in use.
        default: PRIMARY,
        outline: SECONDARY,
        destructive: DANGER_LINK,
      },
      size: {
        xs: "h-[var(--control-h-xs)] text-sm font-medium",
        sm: "h-[var(--control-h-sm)] text-sm",
        md: "h-[var(--control-h-md)]",
        lg: "h-[var(--control-h-lg)]",
        // ui_kit/Entry.jsx: the 44px Clone button is `0 18px`, not `0 14px`.
        xl: "h-[var(--control-h-xl)] rounded-lg px-[18px] text-[14px]",
        icon: "size-[var(--control-h-md)] px-0",
        "icon-xs": "size-[var(--control-h-xs)] px-0",
        "icon-sm": "size-[var(--control-h-sm)] px-0",
        "icon-lg": "size-[var(--control-h-lg)] px-0",
      },
      /**
       * The violet glow under the primary action (handoff shows it on Save
       * and "Open in editor →"). Only the accent fill carries it — see the
       * compound variants; on any other variant `glow` is ignored.
       */
      glow: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { glow: true, variant: "primary", class: "shadow-accent" },
      { glow: true, variant: "default", class: "shadow-accent" },
      // Bar buttons are 28px with a 7px radius wherever they are used.
      { variant: "bar-primary", class: "h-[var(--control-h-xs)] rounded-[7px] px-3 text-sm" },
      { variant: "bar-outline", class: "h-[var(--control-h-xs)] rounded-[7px] px-3 text-sm" },
      // Text links have no box, so a control height would only add dead space.
      { variant: "danger-link", class: "h-auto px-0" },
      { variant: "link", class: "h-auto px-0" },
      { variant: "destructive", class: "h-auto px-0" },
    ],
    defaultVariants: {
      variant: "default",
      size: "md",
      glow: false,
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "md",
  glow = false,
  glyph,
  glyphTone = "accent",
  children,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Leading unicode glyph (✦ ↻ ‹ …). Decorative: the label carries the meaning. */
    glyph?: React.ReactNode
    /**
     * Whether the glyph reads as an icon or as part of the label. The handoff
     * tints the *icon* slot, which is ✦ ("✦ Auto-generate"); ↻ is written into
     * the label itself ("↻ Replay all", "↻ Replay"), so it stays in the
     * button's own ink (`docs/design/design-system/components/core/Button.jsx`
     * next to `ui_kit/Help.jsx` and `ui_kit/Editor.jsx`).
     */
    glyphTone?: "accent" | "ink"
  }) {
  const tintGlyph =
    glyphTone === "accent" && (variant === "secondary" || variant === "outline")

  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, glow, className }))}
      {...props}
    >
      {glyph == null ? null : (
        <span aria-hidden="true" className={tintGlyph ? "text-vm-accent" : ""}>
          {glyph}
        </span>
      )}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
