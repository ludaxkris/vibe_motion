"use client";

import { ELEMENTS_QUERY_LIMIT } from "bridge";
import { useCallback, useMemo, useState } from "react";

import { UnsavedGuardDialog } from "@/components/dialogs/unsaved-guard-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RunFailure, RunOutcome } from "@/lib/agent/run";
import type { Assignment, Trigger } from "@/lib/api-client";
import {
  ALL_CATEGORIES,
  defaultAssignmentFor,
  getCatalogEntry,
  getCatalogEntryAt,
} from "@/lib/catalog";
import {
  selectAgentOwnedVmIds,
  selectAutoResultVmIds,
  selectDirtyVmIdCount,
  selectGuardedVmId,
  useEditorStore,
  useUnsaved,
  type EditorState,
} from "@/lib/store";

import { AutoResultPanel, type AutoResultRow } from "./auto-result";
import { ChoosingPanel } from "./choosing";
import { IdlePanel } from "./idle";
import { PanelCard, PanelSection } from "./panel-card";
import { SelectedPanel } from "./selected";
import { TuningPanel } from "./tuning";
import { useAgentRun } from "./use-agent-run";

/** What the three agent-driven sections share: one run at a time, one message. */
type AgentRunProps = {
  busy: boolean;
  /** The last failure, already narrowed to "it happened on this panel". */
  error: RunFailure | null;
};

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
function IdleSection({
  onAutoGenerate,
  onReplayAll,
  busy,
  error,
}: AgentRunProps & { onAutoGenerate?: () => void; onReplayAll?: () => void }) {
  const draftState = useEditorStore((state) => state.draftState);
  const setSelectedVmId = useEditorStore((state) => state.setSelectedVmId);
  const prompt = useEditorStore((state) => state.prompt);
  const setPrompt = useEditorStore((state) => state.setPrompt);

  return (
    <IdlePanel
      assignments={draftState}
      onSelectElement={setSelectedVmId}
      prompt={prompt}
      onPromptChange={setPrompt}
      onAutoGenerate={onAutoGenerate}
      busy={busy}
      error={error}
      onReplayAll={onReplayAll}
    />
  );
}

/** The selected panel, connected: the element's own text comes from what the bridge reported. */
function SelectedSection({
  vmId,
  onGenerate,
  onBack,
  busy,
  error,
}: AgentRunProps & { vmId: string; onGenerate?: () => void; onBack?: () => void }) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const elementText = useEditorStore((state) => state.elements[vmId]?.textPreview);

  return (
    <SelectedPanel
      vmId={vmId}
      elementText={elementText}
      onChooseCustom={() => dispatchPanel({ type: "CHOOSE_CUSTOM" })}
      onBack={onBack}
      onGenerate={onGenerate}
      busy={busy}
      error={error}
    />
  );
}

/** Document order; an element the bridge never described (or could not place) goes last. */
function orderOf(order: number | undefined): number {
  return order === undefined || order < 0 ? Number.POSITIVE_INFINITY : order;
}

/**
 * The result list, connected, and mounted only in the `auto` state — like
 * `IdleSection`, it reads the whole `draftState`, and the tuning form behind it
 * must not re-render on a slider tick (DT-126).
 *
 * Rows are the last run's elements that still have an assignment (plan D3):
 * a row the designer tuned stays, tagged "edited", because it is no longer the
 * agent's to re-roll or remove.
 */
function AutoSection({
  onRegenerate,
  onReplayAll,
  busy,
  error,
}: AgentRunProps & { onRegenerate?: () => void; onReplayAll?: () => void }) {
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  // A request, not a move (Task 0 result item 9). From the list nothing is
  // selected, so the guard never opens; the front door is still the right one.
  const requestSelect = useEditorStore((state) => state.requestSelect);
  const removeAllGenerated = useEditorStore((state) => state.removeAllGenerated);
  const lastRun = useEditorStore((state) => state.lastRun);
  const draftState = useEditorStore((state) => state.draftState);
  const elements = useEditorStore((state) => state.elements);
  // Both memoised in the store: stable snapshots while their inputs are.
  const resultVmIds = useEditorStore(selectAutoResultVmIds);
  const agentOwnedVmIds = useEditorStore(selectAgentOwnedVmIds);

  const rows = useMemo(() => {
    const agentOwned = new Set(agentOwnedVmIds);
    const built: (AutoResultRow & { order: number })[] = [];
    for (const vmId of resultVmIds) {
      const assignment = draftState[vmId];
      if (!assignment) continue;
      built.push({
        vmId,
        tag: elements[vmId]?.tag ?? "element",
        // The version the assignment pinned, never the current one (rule 9).
        animationName:
          getCatalogEntryAt(assignment.catalogVersion, assignment.animationId)?.name ??
          assignment.animationId,
        trigger: assignment.trigger,
        duration: assignment.params.duration,
        delay: assignment.params.delay,
        edited: !agentOwned.has(vmId),
        order: orderOf(elements[vmId]?.order),
      });
    }
    // `sort` is stable, so unknown elements keep the run's own order.
    return built.sort((a, b) => (a.order === b.order ? 0 : a.order < b.order ? -1 : 1));
  }, [resultVmIds, agentOwnedVmIds, draftState, elements]);

  return (
    <AutoResultPanel
      rows={rows}
      prompt={lastRun?.prompt ?? ""}
      skippedCount={lastRun?.skippedCount ?? 0}
      truncated={lastRun?.truncated ?? false}
      consideredLimit={ELEMENTS_QUERY_LIMIT}
      onSelectRow={requestSelect}
      onRegenerate={() => onRegenerate?.()}
      onReplayAll={() => onReplayAll?.()}
      onRemoveAll={removeAllGenerated}
      onClose={() => dispatchPanel({ type: "AUTO_CLOSE" })}
      regenerateDisabled={!onRegenerate || busy}
      replayDisabled={!onReplayAll}
      // A run in flight re-assigns whatever looks unassigned when it lands, so
      // a Remove all inside that window would be silently undone.
      removeAllDisabled={busy}
      busy={busy}
      error={error}
      runSeed={lastRun?.seed}
    />
  );
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
  onGenerateElement,
  onAutoGeneratePage,
}: {
  currentVersionLabel?: string;
  /** Show an animation transiently on the page (spec D4). Absent until the bridge is mounted. */
  onPreview?: (vmId: string, assignment: Assignment) => void;
  onClearPreview?: () => void;
  /** Restart one element's animation in the preview iframe, or every one when `null`. */
  onReplay?: (vmId: string | null) => void;
  /** "✦ Auto-generate for this element". Absent (button disabled) until the bridge is ready. */
  onGenerateElement?: (vmId: string) => Promise<RunOutcome>;
  /** "✦ Auto-generate for this page" and the result list's Regenerate. Absent until the bridge is ready. */
  onAutoGeneratePage?: (opts?: { regenerate?: boolean }) => Promise<RunOutcome>;
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

  // Busy / error for every agent button lives here, not in the store (Task 0
  // result item 5). A run is started with the `panel` object it was clicked
  // on, and its failure is shown only while that is still the panel: a failure
  // moves nothing, so the message stays put, and it does not follow the
  // designer to a panel it says nothing about.
  const agentRun = useAgentRun();
  const runProps: AgentRunProps = {
    busy: agentRun.busy,
    error: agentRun.errorScope === panel ? agentRun.error : null,
  };
  const { run } = agentRun;
  const replayAll = useMemo(() => (onReplay ? () => onReplay(null) : undefined), [onReplay]);

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
              <IdleSection
                {...runProps}
                onAutoGenerate={
                  onAutoGeneratePage ? () => void run(() => onAutoGeneratePage(), panel) : undefined
                }
                onReplayAll={replayAll}
              />
            )}
            {panel.status === "auto" && (
              <AutoSection
                {...runProps}
                onRegenerate={
                  onAutoGeneratePage
                    ? () => void run(() => onAutoGeneratePage({ regenerate: true }), panel)
                    : undefined
                }
                onReplayAll={replayAll}
              />
            )}
            {panel.status === "selected" && (
              <SelectedSection
                {...runProps}
                vmId={panel.vmId}
                onGenerate={
                  onGenerateElement
                    ? () => void run(() => onGenerateElement(panel.vmId), panel)
                    : undefined
                }
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
      />
    </div>
  );
}
