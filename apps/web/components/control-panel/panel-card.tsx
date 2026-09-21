import * as React from "react";
import { cn } from "cn";

/**
 * The panel's one white card (`docs/design/design-system/components/core/
 * SectionCard.jsx`): it hangs off the folder tabs, so its top-left corner is
 * square and the rest are 10px. Each state renders its own, with
 * `PanelSection`s inside.
 */
export function PanelCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-card"
      className={cn(
        "flex flex-col rounded-lg rounded-tl-none border border-vm-border bg-vm-surface",
        className,
      )}
      {...props}
    />
  );
}

/** One 14px-padded band of the card, hairline-divided from the next. */
export function PanelSection({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-section"
      className={cn(
        "flex flex-col gap-3 border-b border-vm-divider p-3.5 last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The card's "something is on its way" state.
 *
 * `label` is required and is what a screen reader announces, so each tab says
 * what *it* is waiting for — the History tab and the Export tab were
 * announcing the same "Loading history" from copied markup.
 */
export function PanelSpinner({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="flex justify-center py-2">
      <div className="size-5 animate-spin rounded-full border-2 border-vm-border border-t-vm-accent" />
    </div>
  );
}
