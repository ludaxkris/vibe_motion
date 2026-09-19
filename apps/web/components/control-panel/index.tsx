"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UnsavedGuardDialog } from "@/components/dialogs/unsaved-guard-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Assignment, Trigger } from "@/lib/api-client";
import {
  ALL_CATEGORIES,
  CURRENT_CATALOG_VERSION,
  getCatalogEntry,
  getCatalogEntryAt,
  resolveCatalogParams,
} from "@/lib/catalog";
import {
  selectDirtyVmIdCount,
  selectGuardedVmId,
  useEditorStore,
  useUnsaved,
  type EditorState,
} from "@/lib/store";

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
 * The idle list, connected, and mounted only while the panel is idle.
 *
 * `IdlePanel` is the one consumer of the whole `draftState`, so subscribing to
 * it here rather than in `ControlPanel` means a slider tick — which replaces
 * `draftState` on every frame — cannot re-render the tabs, the guard
 * computations and the dialog behind the tuning form (DT-126).
 */
function IdleSection() {
  const draftState = useEditorStore((state) => state.draftState);
  const setSelectedVmId = useEditorStore((state) => state.setSelectedVmId);

  return <IdlePanel assignments={draftState} onSelectElement={setSelectedVmId} />;
}

/**
 * The animation on the one element the guard may name, by name, as a scalar.
 *
 * A selector that returned the assignment itself would be fine too (identity
 * is stable), but the lookup belongs with the thing that needs it, and a
 * string cannot accidentally become a fresh snapshot.
 */
function selectGuardedAnimationName(state: EditorState): string | undefined {
  const vmId = selectGuardedVmId(state);
  if (vmId === null) return undefined;
  const assignment = state.draftState[vmId];
  if (!assignment) return undefined;
  return (
    getCatalogEntryAt(assignment.catalogVersion, assignment.animationId)?.name ??
    assignment.animationId
  );
}

/**
 * The picker's search and category live here rather than in the store: they
 * are this visit's filter, not editor state, and they reset with the element
 * (the caller keys this by `vmId`).
 */
function ChoosingSection({
  vmId,
  onPreview,
  onClearPreview,
}: {
  vmId: string;
  onPreview?: (vmId: string, assignment: Assignment) => void;
  onClearPreview?: () => void;
}) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const appliedAnimationId = useEditorStore((state) => state.draftState[vmId]?.animationId);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  // The picker owns the preview's whole life, and it has to end it itself.
  // A card that is hovered and then *clicked* never gets its `mouseleave`: the
  // pick unmounts the grid out from under the pointer. The preview would then
  // outlive the picker, and because a preview sits on top of the applied
  // assignment (spec D6) every later `apply` — a tuned param, a Discard's
  // revert — would land underneath it and never be seen.
  const clearPreview = useRef(onClearPreview);
  useEffect(() => {
    clearPreview.current = onClearPreview;
  }, [onClearPreview]);
  useEffect(() => () => clearPreview.current?.(), []);

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
      // Exactly what picking the card would create, so the preview is the
      // truth about the click and not an approximation of it.
      onPreview={(animationId) => {
        const assignment = defaultAssignment(animationId);
        if (assignment) onPreview?.(vmId, assignment);
      }}
      onPreviewEnd={onClearPreview}
    />
  );
}

/**
 * The assignment a `PICK` would create: catalog defaults, pinned to the
 * current version, on the entry's own default trigger. Same construction as
 * the store's `PICK` branch, which is what the preview has to stand in for.
 */
function defaultAssignment(animationId: string): Assignment | undefined {
  const entry = getCatalogEntry(animationId);
  if (!entry) return undefined;
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  };
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
  onReplay,
}: {
  vmId: string;
  animationId: string;
  onReplay?: (vmId: string) => void;
}) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const setDraftAssignment = useEditorStore((state) => state.setDraftAssignment);
  const updateDraftParam = useEditorStore((state) => state.updateDraftParam);
  const removeDraftAssignment = useEditorStore((state) => state.removeDraftAssignment);
  const assignment = useEditorStore((state) => state.draftState[vmId]);

  // Stable across a drag, so the memoised rows only see the one value that
  // moved (DT-126). The store actions are already stable identities.
  const handleParamChange = useCallback(
    (key: string, value: string) => updateDraftParam(vmId, key, value),
    [updateDraftParam, vmId],
  );
  // A released slider replays the preview (spec §5) so the designer sees the
  // value they landed on. It writes nothing: `onParamChange` already wrote
  // this exact value on the last drag tick, and a second identical write would
  // allocate a fresh draft, post a duplicate `apply` and re-render the form
  // again — before the replay was allowed out.
  const handleParamCommit = useMemo(
    () => (onReplay ? () => onReplay(vmId) : undefined),
    [onReplay, vmId],
  );
  const handleReplay = useMemo(
    () => (onReplay ? () => onReplay(vmId) : undefined),
    [onReplay, vmId],
  );
  const handleRemove = useCallback(() => {
    removeDraftAssignment(vmId);
    dispatchPanel({ type: "CLEAR" });
  }, [removeDraftAssignment, dispatchPanel, vmId]);
  const handleChangeAnimation = useCallback(
    () => dispatchPanel({ type: "BACK" }),
    [dispatchPanel],
  );

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
      onParamChange={handleParamChange}
      onParamCommit={handleParamCommit}
      onReplay={handleReplay}
      onChangeAnimation={handleChangeAnimation}
      onRemove={handleRemove}
    />
  );
}

const TABS = [
  { value: "animate", label: "Animate" },
  { value: "history", label: "History" },
  { value: "export", label: "Export" },
] as const;

/**
 * Control Panel: idle -> selected -> choosing -> tuning, driven by the
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
export function ControlPanel({
  currentVersionLabel,
  onPreview,
  onClearPreview,
  onReplay,
}: {
  currentVersionLabel?: string;
  /** Show an animation transiently on the page (spec D4). Absent until the bridge is mounted. */
  onPreview?: (vmId: string, assignment: Assignment) => void;
  onClearPreview?: () => void;
  /** Restart one element's animation in the preview iframe. */
  onReplay?: (vmId: string) => void;
}) {
  const panel = useEditorStore((state) => state.panel);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const revertDraft = useEditorStore((state) => state.revertDraft);
  const unsaved = useUnsaved();

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
  // Scalars, not the draft map: this panel must not wake up on a slider tick.
  const guardedAnimationName = useEditorStore(selectGuardedAnimationName);

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
            {panel.status === "idle" && <IdleSection />}
            {panel.status === "selected" && (
              <SelectedPanel
                vmId={panel.vmId}
                onChooseCustom={() => dispatchPanel({ type: "CHOOSE_CUSTOM" })}
              />
            )}
            {panel.status === "choosing" && (
              <ChoosingSection
                key={panel.vmId}
                vmId={panel.vmId}
                onPreview={onPreview}
                onClearPreview={onClearPreview}
              />
            )}
            {panel.status === "tuning" && (
              <TuningSection
                vmId={panel.vmId}
                animationId={panel.animationId}
                onReplay={onReplay}
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
