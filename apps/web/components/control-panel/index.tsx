"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Trigger } from "@/lib/api-client";
import { getCatalogEntry } from "@/lib/catalog";
import { useEditorStore } from "@/lib/store";

import { ALL_CATEGORIES, ChoosingPanel } from "./choosing";
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
 * The picker's search and category live here rather than in the store: they
 * are this visit's filter, not editor state, and they reset with the element
 * (the caller keys this by `vmId`).
 */
function ChoosingSection({ vmId }: { vmId: string }) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const appliedAnimationId = useEditorStore((state) => state.draftState[vmId]?.animationId);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  return (
    <ChoosingPanel
      vmId={vmId}
      appliedAnimationId={appliedAnimationId}
      search={search}
      onSearchChange={setSearch}
      category={category}
      onCategoryChange={setCategory}
      onPick={(animationId) => dispatchPanel({ type: "PICK", animationId })}
      onBack={() => dispatchPanel({ type: "BACK" })}
    />
  );
}

/**
 * Resolves the catalog entry and the draft assignment the tuning panel edits.
 *
 * Both lookups should always succeed — the machine only reaches `tuning` via
 * PICK, which resolves the entry and creates the assignment together — but the
 * two failure modes are distinct (a catalog entry that has gone away vs. a
 * draft cleared out from under a mounted panel) and worth telling apart.
 */
function TuningSection({ vmId, animationId }: { vmId: string; animationId: string }) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const setDraftAssignment = useEditorStore((state) => state.setDraftAssignment);
  const updateDraftParam = useEditorStore((state) => state.updateDraftParam);
  const removeDraftAssignment = useEditorStore((state) => state.removeDraftAssignment);
  const assignment = useEditorStore((state) => state.draftState[vmId]);

  const entry = getCatalogEntry(animationId);
  if (!entry) {
    return (
      <PanelCard data-testid="panel-tuning-missing-entry">
        <PanelSection>
          <p className="text-sm leading-body text-vm-ink-2">
            This animation is no longer in the catalog.
          </p>
        </PanelSection>
      </PanelCard>
    );
  }
  if (!assignment) {
    return (
      <PanelCard data-testid="panel-tuning-missing-draft">
        <PanelSection>
          <p className="text-sm leading-body text-vm-ink-2">
            No draft assignment for this element yet.
          </p>
        </PanelSection>
      </PanelCard>
    );
  }

  return (
    <TuningPanel
      vmId={vmId}
      entry={entry}
      assignment={assignment}
      onTriggerChange={(trigger: Trigger) => setDraftAssignment(vmId, { ...assignment, trigger })}
      onParamChange={(key, value) => updateDraftParam(vmId, key, value)}
      onChangeAnimation={() => dispatchPanel({ type: "BACK" })}
      onRemove={() => {
        removeDraftAssignment(vmId);
        dispatchPanel({ type: "CLEAR" });
      }}
    />
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
            {panel.status === "choosing" && (
              <ChoosingSection key={panel.vmId} vmId={panel.vmId} />
            )}
            {panel.status === "tuning" && (
              <TuningSection vmId={panel.vmId} animationId={panel.animationId} />
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
