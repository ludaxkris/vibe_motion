"use client";

import { ELEMENTS_QUERY_LIMIT } from "bridge";
import { useCallback, useMemo, useState } from "react";

import { UnsavedGuardDialog } from "@/components/dialogs/unsaved-guard-dialog";
import { HistoryTab } from "@/components/history/history-tab";
import { ReadOnlyNote } from "@/components/history/read-only-note";
import type { VersionHistory } from "@/components/history/use-version-history";
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
import { ExportSection } from "./export-section";
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
 * Which tab is open, and — for Export — which version it is open *on*.
 *
 * One object rather than two pieces of state because the guard parks the whole
 * request: "Export v3" raised over an unsaved draft has to come back as v3
 * after Save, not as "the Export tab, on whatever is current now".
 */
type TabRequest = {
  tab: string;
  /**
   * The version the Export tab is pinned to, or null for the project's current
   * one (plan §5.2). Set when the switch is made from a version on screen —
   * the Export tab opened while viewing vN, or a History row's "Export vN" —
   * and dropped again on the way out of the tab.
   */
  exportVersionId: string | null;
  /**
   * The project this request was made for.
   *
   * The shell `reset()`s the store on a project change rather than remounting
   * the panel, so without this a pin — or a request parked behind the guard —
   * outlives the project it belongs to, and the Export tab asks project B for
   * a version of project A's. Compared rather than cleared in an effect, so
   * there is no render in which the stale request is the one on screen.
   */
  projectId?: string;
};

const ANIMATE: TabRequest = { tab: TABS[0].value, exportVersionId: null };

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
  projectId,
  projectTitle,
  currentVersionLabel,
  history,
  onPreview,
  onClearPreview,
  onReplay,
  onSave,
  onGenerateElement,
  onAutoGeneratePage,
}: {
  /** The project the Export tab exports. Absent (no project behind the panel) leaves it on its placeholder. */
  projectId?: string;
  /** The project's name; only the exported zip's file name ever sees it. */
  projectTitle?: string;
  currentVersionLabel?: string;
  /**
   * The shell's `useVersionHistory` — the History tab's list, and the view /
   * back / restore it offers. Mounted there rather than here so the tab's
   * rows and the preview's banner share one `restoring` flag. Absent (no
   * project behind the panel) leaves the tab on its placeholder.
   */
  history?: VersionHistory;
  /** Show an animation transiently on the page (spec D4). Absent until the bridge is mounted. */
  onPreview?: (vmId: string, assignment: Assignment) => void;
  onClearPreview?: () => void;
  /** Restart one element's animation in the preview iframe, or every one when `null`. */
  onReplay?: (vmId: string | null) => void;
  /**
   * The shell's Save flow, for the tab guard's Save. It resolves once a
   * version exists and rejects on every exit that wrote nothing, so a
   * cancelled save leaves the guard standing. Absent leaves Save disabled.
   */
  onSave?: () => Promise<void>;
  /** "✦ Auto-generate for this element". Absent (button disabled) until the bridge is ready. */
  onGenerateElement?: (vmId: string) => Promise<RunOutcome>;
  /** "✦ Auto-generate for this page" and the result list's Regenerate. Absent until the bridge is ready. */
  onAutoGeneratePage?: (opts?: { regenerate?: boolean }) => Promise<RunOutcome>;
}) {
  const panel = useEditorStore((state) => state.panel);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const revertDraft = useEditorStore((state) => state.revertDraft);
  const unsaved = useUnsaved();
  // The store is what makes viewing read-only (every draft writer returns
  // early); this is the same fact where the reader can see it.
  const viewing = useEditorStore((state) => state.mode === "viewing");

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
  const [committedTab, setCommittedTab] = useState<TabRequest>(ANIMATE);
  const [pendingTab, setPendingTab] = useState<TabRequest | null>(null);
  /** A request made for a project the reader has left says nothing about this one. */
  const ofThisProject = (request: TabRequest | null): TabRequest | null =>
    request !== null && request.projectId === projectId ? request : null;
  const committed = ofThisProject(committedTab) ?? ANIMATE;
  const parked = ofThisProject(pendingTab);
  // A guard with nothing left to lose is no longer a question. The draft can
  // go clean without this component's promise resolving — the 409's "Discard
  // my changes" loads their version, so `requestSave()` rightly rejects — and
  // the guard used to stay open over a clean draft, claiming unsaved changes,
  // with a Save that could do nothing at all. Derived rather than reconciled
  // in an effect, so there is no render in which that is true.
  const guardHeld = unsaved && parked !== null;
  const open = guardHeld ? committed : (parked ?? committed);
  const tab = open.tab;

  // The tab switch, which is also how Export is guarded (DT-099): the Export
  // tab exports a saved version, so an unsaved draft has to be dealt with
  // before it opens. Guard-on-element-click is the shell's own mounting.
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

  // Discard's success path minus the revert: the draft has just *become* the
  // saved version, so only the tab still has to move — and only once the
  // version actually exists, which is what the resolved promise says.
  /**
   * Make a request the tab that is open. The one way in: every release of the
   * guard goes through here too, so what leaving a tab *means* is a property
   * of the switch rather than of one of its three callers.
   */
  const commit = (next: TabRequest) => {
    // Viewing is a read-only detour that belongs to the History tab, so
    // leaving the tab returns to the current version — the editor is never in
    // viewing mode with History closed (docs/user_flow.md §4). Called even
    // when nothing is on screen yet: `back()` is also what cancels a version
    // still loading. The version being left is already pinned in `next` when
    // the reader asked for its export.
    if (open.tab === "history") history?.back();
    // Any tab the user lands on is the whole answer: a parked request left
    // over from a guard that went away with the unsaved work has nothing left
    // to say.
    setPendingTab(null);
    setCommittedTab(next);
  };

  const handleGuardSave = onSave
    ? () =>
        onSave().then(
          () => {
            // The parked request, version and all — and with `exportVersionId`
            // null (the only way to reach the guard is with a draft, which
            // means not viewing), the Export tab opens on the version this
            // very save has just created.
            if (parked !== null) commit(parked);
            else setPendingTab(null);
          },
          // Cancelled or failed: the guard stays open with its question intact.
          () => {},
        )
    : undefined;

  /**
   * Ask for a tab. The guard decides whether the request is honoured now or
   * parked until the draft is dealt with.
   *
   * `exportVersionId` is only ever non-null for the Export tab: it is the
   * version on screen at the moment of the switch (plan §5.2).
   */
  const openTab = (next: TabRequest) => {
    const request = { ...next, projectId };
    if (request.tab === open.tab && request.exportVersionId === open.exportVersionId) return;
    if (unsaved) {
      setPendingTab(request);
      return;
    }
    commit(request);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={tab}
        onValueChange={(next) => {
          const value = String(next);
          if (value === tab) return;
          openTab({
            tab: value,
            // "Any saved version can be exported directly while viewing it,
            // without restoring" (docs/user_flow.md §4). Read here, before
            // `openTab` leaves the History tab and ends the viewing.
            exportVersionId: value === "export" ? (history?.viewingVersionId ?? null) : null,
          });
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
          {/* Above the inert content below, so it stays readable. */}
          {tab === "animate" && viewing && history?.viewingLabel && history.currentLabel ? (
            <ReadOnlyNote
              viewingLabel={history.viewingLabel}
              currentLabel={history.currentLabel}
            />
          ) : null}
          <TabsContent
            value="animate"
            // A past version on screen is read-only: the store refuses every
            // draft write — the agent runs included — and `inert` keeps these
            // controls from taking a click or the keyboard at all
            // (docs/user_flow.md §6).
            inert={viewing}
            className={viewing ? "opacity-40" : undefined}
          >
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
            {history ? (
              <HistoryTab
                history={history}
                // DT-160. Export vN pins vN and opens the Export tab; the
                // switch itself leaves viewing, so the canvas goes back to the
                // current version while the panel exports the one asked for
                // (plan §5.2). Only offered with a project behind the panel,
                // because there is nothing to export without one.
                onExport={
                  projectId
                    ? (versionId) => openTab({ tab: "export", exportVersionId: versionId })
                    : undefined
                }
              />
            ) : (
              <PlaceholderTab>
                Saved versions appear here. A version is only created when you click Save.
              </PlaceholderTab>
            )}
          </TabsContent>

          {/* Base UI renders a `TabsContent` only while its tab is open
              (`keepMounted: false`), which is what keeps the export request
              from being issued behind the Animate tab — and keeps the
              section's store reads off the slider's path (DT-126).
              
              `h-full`, unlike the two tabs above, and it is load-bearing: the
              scroll container around these panels is a block box, so a
              content-driven `flex-1` chain resolves to the *length of the
              exported file* — 14,000px for a page of 800 elements — leaving
              the code block unscrollable and Copy all / Download .zip that
              far below the fold. Animate and History are lists that should
              scroll the column; the Export panel is a fixed frame whose code
              block scrolls inside itself
              (`apps/e2e/web/mocked/export.spec.ts` measures all three). */}
          <TabsContent value="export" className="flex h-full min-h-0 flex-col">
            {projectId && history ? (
              <ExportSection
                projectId={projectId}
                projectTitle={projectTitle}
                history={history}
                exportVersionId={open.exportVersionId}
              />
            ) : (
              <PlaceholderTab>
                Your page’s HTML, CSS and JS appear here, built from a saved version.
              </PlaceholderTab>
            )}
          </TabsContent>
        </div>
      </Tabs>

      <p className="px-4 pt-2.5 pb-3 text-xs leading-body text-vm-ink-2">
        Save and Cancel live in the top bar so they’re never scrolled away.
      </p>

      <UnsavedGuardDialog
        open={guardHeld}
        elementLabel={guardedVmId ?? undefined}
        animationName={guardedAnimationName}
        unsavedElementCount={unsavedElementCount}
        currentVersionLabel={currentVersionLabel}
        onDiscard={() => {
          revertDraft();
          if (parked !== null) commit(parked);
          else setPendingTab(null);
        }}
        onKeepEditing={() => setPendingTab(null)}
        onSave={handleGuardSave}
        saveDisabled={onSave === undefined}
      />
    </div>
  );
}
