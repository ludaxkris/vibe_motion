import { cn } from "cn";
import type { ReactNode } from "react";

import { DIALOG_CARD, DIALOG_SCRIM } from "@/components/ui/dialog";

/**
 * A dialog staged open inside a gallery frame: the same scrim and the same
 * card as the real modal (`components/ui/dialog.tsx` exports both class sets),
 * but rendered in place — no portal, no focus trap, so several can sit on the
 * page at once without fighting each other for focus.
 *
 * Gallery-only: the editor always uses the real `Dialog`.
 */
export function StaticDialog({
  className,
  children,
}: {
  /** The dialog's width, e.g. `w-[380px]`. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex items-center justify-center p-6", DIALOG_SCRIM)}>
      <div className={cn(DIALOG_CARD, className)}>{children}</div>
    </div>
  );
}
