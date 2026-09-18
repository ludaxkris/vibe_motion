"use client";

import { Button } from "@/components/ui/button";
import { useEditorStore } from "@/lib/store";

/** An element is selected but has no animation yet: offer Generate (Phase 5+) or Custom. */
export function SelectedPanel({ vmId }: { vmId: string }) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);

  return (
    <div className="flex flex-col gap-3" data-testid="panel-selected">
      <p className="text-sm">
        Selected <span className="font-mono text-xs">{vmId}</span>
      </p>
      <div className="flex flex-col gap-1.5">
        <Button size="sm" disabled aria-describedby="generate-hint">
          Generate
        </Button>
        {/* A disabled button never fires a hover/focus tooltip, so the hint is
            visible helper text instead. */}
        <p id="generate-hint" className="text-xs text-muted-foreground">
          Arrives in Phase 5.
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => dispatchPanel({ type: "CHOOSE_CUSTOM" })}
        >
          Custom
        </Button>
      </div>
    </div>
  );
}
