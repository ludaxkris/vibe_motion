import { Button } from "@/components/ui/button";

/**
 * The "‹" at the head of a panel: up one level. One control, so choosing,
 * tuning, selected and the auto-generate result list cannot drift apart.
 */
export function PanelBackButton({ onClick }: { onClick?: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Back"
      glyph="‹"
      onClick={onClick}
      className="-ml-1.5 text-lg"
    />
  );
}
