"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEditorStore } from "@/lib/store";

import { ChoosingPanel } from "./choosing";
import { IdlePanel } from "./idle";
import { PanelCard, PanelSection } from "./panel-card";
import { SelectedPanel } from "./selected";
import { TuningPanel } from "./tuning";

/** A tab whose screen lands in a later phase: one muted line, no empty chrome. */
function PlaceholderTab({ children }: { children: string }) {
  return (
    <PanelCard>
      <PanelSection>
        <p className="text-sm leading-body text-vm-ink-2">{children}</p>
      </PanelSection>
    </PanelCard>
  );
}

/**
 * Control Panel: idle -> selected -> choosing -> tuning, driven by the
 * `panel` state machine (`lib/store/panel-machine.ts`), under the handoff's
 * folder tabs (`docs/design/README.md` "2. Editor").
 *
 * This is the store-connected container: every state below is presentational
 * and takes what it needs as props, so `/dev` (Task 9) can render them all
 * without touching the store.
 *
 * Element selection from the preview iframe arrives with the bridge (Phase 4);
 * until then `panel` is only advanced from here, `/dev/panel` and tests.
 */
export function ControlPanel() {
  const panel = useEditorStore((state) => state.panel);
  const draftState = useEditorStore((state) => state.draftState);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const setSelectedVmId = useEditorStore((state) => state.setSelectedVmId);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs defaultValue="animate" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList variant="folder">
          <TabsTrigger value="animate">Animate</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="export">Export</TabsTrigger>
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <TabsContent value="animate">
            {panel.status === "idle" && (
              <IdlePanel assignments={draftState} onSelectElement={setSelectedVmId} />
            )}
            {panel.status === "selected" && (
              <SelectedPanel
                vmId={panel.vmId}
                onChooseCustom={() => dispatchPanel({ type: "CHOOSE_CUSTOM" })}
              />
            )}
            {panel.status === "choosing" && <ChoosingPanel vmId={panel.vmId} />}
            {panel.status === "tuning" && (
              <TuningPanel vmId={panel.vmId} animationId={panel.animationId} />
            )}
          </TabsContent>

          <TabsContent value="history">
            <PlaceholderTab>
              Saved versions appear here. A version is only created when you click Save.
            </PlaceholderTab>
          </TabsContent>

          <TabsContent value="export">
            <PlaceholderTab>Export arrives with Phase 7.</PlaceholderTab>
          </TabsContent>
        </div>
      </Tabs>

      <p className="px-4 pt-2.5 pb-3 text-xs leading-body text-vm-ink-2">
        Save and Cancel live in the top bar so they’re never scrolled away.
      </p>
    </div>
  );
}
