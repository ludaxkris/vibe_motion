import * as React from "react"
import { cn } from "cn"

/**
 * The 44px deep-violet bar that tops every screen (docs/design/ui_kit/
 * TopBar.jsx). Three slots, left to right: the wordmark, an optional context
 * (the project's host+path on the editor, "Animations" on help) with an
 * optional mono chip beside it, and the actions at the end.
 *
 * The bar is a component, not layout: what it carries differs per screen, so
 * each screen renders its own (Tasks 7–10).
 */
export function TopBar({
  title,
  chip,
  actions,
  className,
  children,
  ...props
}: React.ComponentProps<"header"> & {
  /** Project host+path, catalog section name — plain text next to the wordmark. */
  title?: React.ReactNode
  /** Mono pill beside the title ("v5", "catalog 1.0.0"). */
  chip?: React.ReactNode
  /** Right-hand controls (Help · Cancel · Save). */
  actions?: React.ReactNode
}) {
  const hasContext = title != null || chip != null

  return (
    <header
      data-slot="top-bar"
      className={cn(
        "flex h-[var(--topbar-h)] shrink-0 items-center gap-3.5 bg-vm-bar px-4 text-vm-bar-ink",
        className
      )}
      {...props}
    >
      <span className="text-md font-bold tracking-snug">Vibe Motion</span>

      {hasContext ? (
        <>
          <span
            data-slot="top-bar-divider"
            aria-hidden="true"
            className="h-4 w-px shrink-0 bg-vm-bar-border"
          />
          <span data-slot="top-bar-context" className="flex min-w-0 items-center gap-2">
            {title == null ? null : (
              <span className="truncate text-md font-medium text-vm-bar-ink-muted">{title}</span>
            )}
            {chip == null ? null : (
              <span className="shrink-0 rounded-xs bg-vm-bar-chip px-1.5 py-0.5 font-mono text-xs font-medium">
                {chip}
              </span>
            )}
          </span>
        </>
      ) : null}

      {children}

      {actions == null ? null : (
        <span data-slot="top-bar-actions" className="ms-auto flex items-center gap-2">
          {actions}
        </span>
      )}
    </header>
  )
}
