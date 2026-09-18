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
