"use client";

import { Info } from "lucide-react";
import Link from "next/link";

import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditorStore } from "@/lib/store";

/**
 * Control Panel (wireframe).
 *
 * Phase 5 turns this into the explicit state machine from docs/build_plan.md:
 * idle → selected → choosing → tuning. Phase 6 fills the Versions tab. For now
 * it only reads the placeholder store so the client boundary is real.
 */
export function ControlPanel() {
  const selectedVmId = useEditorStore((state) => state.selectedVmId);
  const unsaved = useEditorStore((state) => state.unsaved);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-tight">Control Panel</h2>
        {/* docs/user_flow.md §2: Help opens in a new tab so the draft is untouched. */}
        <Link
          href="/help"
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Help
        </Link>
        <Tooltip>
          <TooltipTrigger
            aria-label="About the Control Panel"
            className="text-muted-foreground hover:text-foreground"
          >
            <Info className="size-4" />
          </TooltipTrigger>
          <TooltipContent>
            Generate, Custom and live tuning arrive in Phase 5. This panel is a
            placeholder.
          </TooltipContent>
        </Tooltip>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">
          <Tabs defaultValue="animation" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="animation">Animation</TabsTrigger>
              <TabsTrigger value="versions">Versions</TabsTrigger>
            </TabsList>
            <TabsContent value="animation" className="pt-3">
              <p className="text-sm text-muted-foreground">
                {selectedVmId
                  ? `Selected ${selectedVmId}.`
                  : "Nothing selected. Click a component in the preview to choose or generate an animation."}
              </p>
            </TabsContent>
            <TabsContent value="versions" className="pt-3">
              <p className="text-sm text-muted-foreground">
                Saved versions appear here. A version is only created when you
                click Save.
              </p>
            </TabsContent>
          </Tabs>
          <Separator />
          <p className="text-xs text-muted-foreground">
            {unsaved ? "Unsaved changes" : "No unsaved changes"} · the draggable
            divider is Phase 3
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
