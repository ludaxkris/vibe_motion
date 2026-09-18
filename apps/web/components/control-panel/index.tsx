"use client";

import { Info } from "lucide-react";
import Link from "next/link";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditorStore } from "@/lib/store";

import { ChoosingPanel } from "./choosing";
import { IdlePanel } from "./idle";
import { SelectedPanel } from "./selected";
import { TuningPanel } from "./tuning";

/**
 * Control Panel: idle -> selected -> choosing -> tuning, driven by the
 * `panel` state machine (`lib/store/panel-machine.ts`). Element selection
 * from the preview iframe arrives with the bridge (Phase 4); until then
 * `panel` is only advanced by `/dev/panel` and tests.
 */
export function ControlPanel() {
  const panel = useEditorStore((state) => state.panel);

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
            Click a component in the preview to generate or choose an
            animation, then tune it live.
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
              {panel.status === "idle" && <IdlePanel />}
              {panel.status === "selected" && <SelectedPanel vmId={panel.vmId} />}
              {panel.status === "choosing" && <ChoosingPanel vmId={panel.vmId} />}
              {panel.status === "tuning" && (
                <TuningPanel vmId={panel.vmId} animationId={panel.animationId} />
              )}
            </TabsContent>
            <TabsContent value="versions" className="pt-3">
              <p className="text-sm text-muted-foreground">
                Saved versions appear here. A version is only created when you
                click Save.
              </p>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
