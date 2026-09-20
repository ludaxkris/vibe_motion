"use client";

import { useCallback, useMemo, useState } from "react";

import { UnsavedGuardDialog } from "@/components/dialogs/unsaved-guard-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Assignment, Trigger } from "@/lib/api-client";
import {
  ALL_CATEGORIES,
  defaultAssignmentFor,
  getCatalogEntry,
  getCatalogEntryAt,
} from "@/lib/catalog";
import {
  selectDirtyVmIdCount,
  selectGuardedVmId,
  useEditorStore,
  useUnsaved,
  type EditorState,
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
  const applied = useEditorStore((state) => state.draftState[vmId]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);

  // Each `AnimationCard` ends the preview it started, including when it is
  // unmounted by the pick or filtered out from under the pointer, so the
  // picker needs no cleanup of its own.
  return (
    <ChoosingPanel
      vmId={vmId}
      appliedAnimationId={applied?.animationId}
      search={search}
      onSearchChange={setSearch}
      category={category}
      onCategoryChange={setCategory}
      onPick={(animationId) => dispatchPanel({ type: "PICK", animationId })}
      onBack={() => dispatchPanel({ type: "BACK" })}
      // Exactly what picking the card would do, so the preview is the truth
      // about the click and not an approximation of it — and for the card
      // *already* applied that means the element's own tuned assignment,
      // because `PICK` deliberately keeps it rather than resetting it. The
      // element would otherwise snap back to 600ms on hover.
      onPreview={(animationId) => {
        const entry = getCatalogEntry(animationId);
        const assignment =
          applied?.animationId === animationId ? applied : entry && defaultAssignmentFor(entry);
        if (assignment) onPreview?.(vmId, assignment);
      }}
      onPreviewEnd={onClearPreview}
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
  onReplay,
  onBack,
}: {
  vmId: string;
  animationId: string;
  onReplay?: (vmId: string) => void;
  onBack?: () => void;
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
  // CHANGE, not BACK: BACK means "up one level", which from a tuning panel
  // opened from the result list is the list, not the picker.
  const handleChangeAnimation = useCallback(
    () => dispatchPanel({ type: "CHANGE" }),
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
      onBack={onBack}
      onRemove={handleRemove}
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
export function ControlPanel({
  currentVersionLabel,
  onPreview,
  onClearPreview,
  onReplay,
  onSave,
}: {
  currentVersionLabel?: string;
  /** Show an animation transiently on the page (spec D4). Absent until the bridge is mounted. */
  onPreview?: (vmId: string, assignment: Assignment) => void;
  onClearPreview?: () => void;
  /** Restart one element's animation in the preview iframe. */
  onReplay?: (vmId: string) => void;
  /**
   * The shell's Save flow, for the tab guard's Save. It resolves once a
   * version exists and rejects on every exit that wrote nothing, so a
   * cancelled save leaves the guard standing. Absent leaves Save disabled.
   */
  onSave?: () => Promise<void>;
}) {
  const panel = useEditorStore((state) => state.panel);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
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
  // Scalars, not the draft map: this panel must not wake up on a slider tick.
  const guardedAnimationName = useEditorStore(selectGuardedAnimationName);
  // A stable action, so subscribing to it never re-renders this panel.
  const setSelectedVmId = useEditorStore((state) => state.setSelectedVmId);

  // Discard's success path minus the revert: the draft has just *become* the
  // saved version, so only the tab still has to move — and only once the
  // version actually exists, which is what the resolved promise says.
  const handleGuardSave = onSave
    ? () =>
        onSave().then(
          () => {
            if (pendingTab !== null) setTab(pendingTab);
            setPendingTab(null);
          },
          // Cancelled or failed: the guard stays open with its question intact.
          () => {},
        )
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
            {panel.status === "idle" && <IdleSection />}
            {/* Unreachable in the app until Phase 5 Track B (Tasks 4-5): nothing
                dispatches AUTO_DONE yet, and the rows, prompt, Regenerate,
                Replay all and Remove all need store state (`lastRun`,
                `generated`, `prompt`) that lands there. What needs no new
                state is already wired: row -> select, "‹" -> AUTO_CLOSE. The
                rest is disabled, so no control looks live and does nothing. */}
            {panel.status === "auto" && (
              <AutoResultPanel
                rows={NO_ROWS}
                prompt=""
                skippedCount={0}
                truncated={false}
                consideredLimit={0}
                onSelectRow={setSelectedVmId}
                onRegenerate={() => undefined}
                onReplayAll={() => undefined}
                onRemoveAll={() => undefined}
                onClose={() => dispatchPanel({ type: "AUTO_CLOSE" })}
                regenerateDisabled
                replayDisabled
                removeAllDisabled
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
        onSave={handleGuardSave}
        saveDisabled={onSave === undefined}
      />
    </div>
  );
}
