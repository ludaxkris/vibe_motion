"use client";

import { useState } from "react";

import { UnsavedGuardDialog } from "@/components/dialogs/unsaved-guard-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Trigger } from "@/lib/api-client";
import { ALL_CATEGORIES, getCatalogEntryAt } from "@/lib/catalog";
import {
  selectDirtyVmIdCount,
  selectGuardedVmId,
  useEditorStore,
  useUnsaved,
} from "@/lib/store";

import { AutoResultPanel } from "./auto-result";
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
 *
 * The entry comes from the version the *assignment* pinned, not from the
 * current catalog: catalog versions differ in their params (1.1.0 gave every
 * entry a `fillMode` 1.0.0 has none of), and a row for a param the pinned
 * version never had would write a value that version cannot validate
 * (CLAUDE.md rule 9). That is also why the assignment is read before the entry.
 */
function TuningSection({
  vmId,
  animationId,
  onBack,
}: {
  vmId: string;
  animationId: string;
  onBack?: () => void;
}) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const setDraftAssignment = useEditorStore((state) => state.setDraftAssignment);
  const updateDraftParam = useEditorStore((state) => state.updateDraftParam);
  const removeDraftAssignment = useEditorStore((state) => state.removeDraftAssignment);
  const assignment = useEditorStore((state) => state.draftState[vmId]);

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

  const entry = getCatalogEntryAt(assignment.catalogVersion, animationId);
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

  return (
    <TuningPanel
      vmId={vmId}
      entry={entry}
      assignment={assignment}
      onTriggerChange={(trigger: Trigger) => setDraftAssignment(vmId, { ...assignment, trigger })}
      onParamChange={(key, value) => updateDraftParam(vmId, key, value)}
      // CHANGE, not BACK: BACK means "up one level", which from a tuning panel
      // opened from the result list is the list, not the picker.
      onChangeAnimation={() => dispatchPanel({ type: "CHANGE" })}
      onBack={onBack}
      onRemove={() => {
        removeDraftAssignment(vmId);
        dispatchPanel({ type: "CLEAR" });
      }}
    />
  );
}

const TABS = [
  { value: "animate", label: "Animate" },
  { value: "history", label: "History" },
  { value: "export", label: "Export" },
] as const;

/** Stable: the `auto` state has no rows until Phase 5 Track B derives them. */
const NO_ROWS: never[] = [];
const noop = () => {};

/**
 * Control Panel: idle -> selected -> choosing -> tuning (+ the `auto` result
 * list), driven by the
 * `panel` state machine (`lib/store/panel-machine.ts`), under the handoff's
 * folder tabs (`docs/design/README.md` "2. Editor").
 *
 * This is the store-connected container: every state below is presentational
 * and takes what it needs as props, so `/dev` (Task 9) renders them all
 * without touching the store.
 *
 * Element selection from the preview iframe arrives with the bridge (Phase 4);
 * until then `panel` is only advanced from here, `/dev` and tests.
 */
export function ControlPanel({ currentVersionLabel }: { currentVersionLabel?: string }) {
  const panel = useEditorStore((state) => state.panel);
  const draftState = useEditorStore((state) => state.draftState);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const setSelectedVmId = useEditorStore((state) => state.setSelectedVmId);
  const revertDraft = useEditorStore((state) => state.revertDraft);
  const unsaved = useUnsaved();

  // "‹" on selected/tuning exists only for an element opened from the result
  // list; everywhere else there is no level above to go back up to.
  const backToResults =
    "returnTo" in panel && panel.returnTo === "auto"
      ? () => dispatchPanel({ type: "BACK" })
      : undefined;

  // The tab is controlled so an unsaved draft can hold the switch: the guard
  // parks the requested tab here and `onValueChange` is simply not honoured
  // until the user says what to do with the draft (docs/user_flow.md §1,
  // "unsaved → History/Export → guard").
  const [tab, setTab] = useState<string>(TABS[0].value);
  const [pendingTab, setPendingTab] = useState<string | null>(null);

  // Guard-on-element-click and guard-on-Export/Restore are later phases; this
  // is the tab switch only.
  //
  // Discard reverts the *whole* draft (that is what switching to History or
  // Export requires), so the dialog only names an element when that element's
  // changes are all there are to lose — otherwise it asks the generic question
  // and counts them. `selectGuardedVmId` is where both conditions live.
  const guardedVmId = useEditorStore(selectGuardedVmId);
  const unsavedElementCount = useEditorStore(selectDirtyVmIdCount);
  const guardedAssignment = guardedVmId === null ? undefined : draftState[guardedVmId];
  const guardedAnimationName = guardedAssignment
    ? (getCatalogEntryAt(guardedAssignment.catalogVersion, guardedAssignment.animationId)?.name ??
      guardedAssignment.animationId)
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          const value = String(next);
          if (value === tab) return;
          if (unsaved) {
            setPendingTab(value);
            return;
          }
          setTab(value);
        }}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <TabsList variant="folder">
          {TABS.map(({ value, label }) => (
            <TabsTrigger
              key={value}
              value={value}
              // "while unsaved the inactive tabs are #cfc9e6 and clicking them
              // triggers the guard" (handoff, "2. Editor").
              className={
                unsaved && value !== tab ? "text-vm-ink-4 hover:text-vm-ink-4" : undefined
              }
            >
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="min-h-0 flex-1 overflow-y-auto px-3">
          <TabsContent value="animate">
            {panel.status === "idle" && (
              <IdlePanel assignments={draftState} onSelectElement={setSelectedVmId} />
            )}
            {/* Unreachable in the app until Phase 5 Track B (Tasks 4-5): nothing
                dispatches AUTO_DONE yet, and the rows, prompt, Regenerate,
                Replay all and Remove all need store state (`lastRun`,
                `generated`, `prompt`) that lands there. What needs no new
                state is already wired: row -> select, "‹" -> AUTO_CLOSE. */}
            {panel.status === "auto" && (
              <AutoResultPanel
                rows={NO_ROWS}
                prompt=""
                skippedCount={0}
                truncated={false}
                onSelectRow={setSelectedVmId}
                onRegenerate={noop}
                onReplayAll={noop}
                onRemoveAll={noop}
                onClose={() => dispatchPanel({ type: "AUTO_CLOSE" })}
                replayDisabled
              />
            )}
            {panel.status === "selected" && (
              <SelectedPanel
                vmId={panel.vmId}
                onChooseCustom={() => dispatchPanel({ type: "CHOOSE_CUSTOM" })}
                onBack={backToResults}
              />
            )}
            {panel.status === "choosing" && (
              <ChoosingSection key={panel.vmId} vmId={panel.vmId} />
            )}
            {panel.status === "tuning" && (
              <TuningSection
                vmId={panel.vmId}
                animationId={panel.animationId}
                onBack={backToResults}
              />
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

      <UnsavedGuardDialog
        open={pendingTab !== null}
        elementLabel={guardedVmId ?? undefined}
        animationName={guardedAnimationName}
        unsavedElementCount={unsavedElementCount}
        currentVersionLabel={currentVersionLabel}
        onDiscard={() => {
          revertDraft();
          if (pendingTab !== null) setTab(pendingTab);
          setPendingTab(null);
        }}
        onKeepEditing={() => setPendingTab(null)}
      />
    </div>
  );
}
