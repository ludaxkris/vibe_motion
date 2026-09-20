"use client";

import { getEntry } from "animation-catalog";
import { cn } from "cn";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";

import { AutoResultPanel, type AutoResultRow } from "@/components/control-panel/auto-result";
import { ChoosingPanel } from "@/components/control-panel/choosing";
import { IdlePanel } from "@/components/control-panel/idle";
import { SelectedPanel } from "@/components/control-panel/selected";
import { TuningPanel } from "@/components/control-panel/tuning";
import {
  SAVE_DIALOG_WIDTH,
  SaveDialogContent,
} from "@/components/dialogs/save-dialog";
import {
  UNSAVED_GUARD_DIALOG_WIDTH,
  UnsavedGuardDialogContent,
} from "@/components/dialogs/unsaved-guard-dialog";
import { CloneRequestError, describeCloneFailure } from "@/components/entry/clone-failure";
import {
  CloneFailureNotice,
  OtherCloneFailureReasons,
} from "@/components/entry/clone-failure-notice";
import { CloningCard } from "@/components/entry/cloning-card";
import { Button } from "@/components/ui/button";
import { ToastPill, useToast } from "@/components/ui/toast";
import type { Assignment, EditorStateMap, Trigger } from "@/lib/api-client";
import {
  ALL_CATEGORIES,
  CURRENT_CATALOG_VERSION,
  getCatalogEntry,
  resolveCatalogParams,
} from "@/lib/catalog";
import { summariseDiff } from "@/lib/diff-summary";

import { StaticDialog } from "./static-dialog";

/** The gallery renders looks, not behaviour: a callback that exists is an enabled control. */
const noop = () => undefined;

/**
 * Fixed `data-vm-id`s. The bridge (Phase 4) is what puts real ones on screen;
 * until then the element label *is* the id, which is what the panels show.
 */
const VM_HEADLINE = "vm-3";
const VM_CTA = "vm-9";
const VM_DROPPED = "vm-14";

/** What a frame says instead of rendering, when its animation has left the catalog. */
function missingEntryNote(animationId: string): string {
  return `${animationId} is not in catalog ${CURRENT_CATALOG_VERSION}.`;
}

/**
 * A draft assignment at the catalog's own defaults, or `undefined` when the id
 * has gone.
 *
 * Nothing on this page may throw while resolving an id: `next build` renders
 * the route to discover it is a 404, so a module-scope throw over a catalog
 * entry that moved would fail the production build of an app that does not
 * even serve this page.
 */
function sampleAssignment(animationId: string, trigger?: Trigger): Assignment | undefined {
  const entry = getCatalogEntry(animationId);
  if (!entry) return undefined;
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: trigger ?? entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  };
}

/** `vmId -> animationId` pairs, minus any the catalog no longer has. */
function sampleState(rows: ReadonlyArray<readonly [string, string, Trigger?]>): EditorStateMap {
  const state: EditorStateMap = {};
  for (const [vmId, animationId, trigger] of rows) {
    const assignment = sampleAssignment(animationId, trigger);
    if (assignment) state[vmId] = assignment;
  }
  return state;
}

/** What the last saved version holds. */
const SAVED_STATE: EditorStateMap = sampleState([
  [VM_CTA, "pulse"],
  [VM_DROPPED, "shake"],
]);

/** …and where the draft has got to: one added, one retriggered, one dropped. */
const DRAFT_STATE: EditorStateMap = sampleState([
  [VM_HEADLINE, "fade-in-up"],
  [VM_CTA, "pulse", "hover"],
]);

const SAMPLE_DIFF = summariseDiff(SAVED_STATE, DRAFT_STATE, getEntry);

/** The handoff's showcased clone failure (`docs/design/README.md`, Entry state 3b). */
const SAMPLE_FAILURE = describeCloneFailure(
  new CloneRequestError(422, "login_required", "login required"),
);

/**
 * One result-list row at the catalog's own name and defaults — `undefined`
 * when the id has gone, for the reason `sampleAssignment` gives. `tuned` is
 * what the designer changed by hand since the run, which is what makes a row
 * read "edited".
 */
function sampleAutoResultRow(
  vmId: string,
  tag: string,
  animationId: string,
  trigger?: Trigger,
  tuned?: { duration?: string; delay?: string },
): AutoResultRow | undefined {
  const entry = getCatalogEntry(animationId);
  const assignment = sampleAssignment(animationId, trigger);
  if (!entry || !assignment) return undefined;
  return {
    vmId,
    tag,
    animationName: entry.name,
    trigger: assignment.trigger,
    duration: tuned?.duration ?? assignment.params.duration ?? "",
    delay: tuned?.delay ?? assignment.params.delay ?? "",
    edited: tuned !== undefined,
  };
}

/** What a page auto-generate run leaves behind; the middle row has been hand-tuned since. */
const AUTO_RESULT_ROWS: AutoResultRow[] = [
  sampleAutoResultRow(VM_HEADLINE, "h1", "fade-in-up", "load"),
  sampleAutoResultRow(VM_DROPPED, "p", "fade-in", "in-view", { duration: "900ms" }),
  sampleAutoResultRow(VM_CTA, "a", "pulse", "hover"),
].filter((row): row is AutoResultRow => row !== undefined);

function Frame({
  slug,
  title,
  note,
  bodyClassName,
  children,
}: {
  /** The screenshot runner's handle: `data-testid="dev-frame-<slug>"`. */
  slug: string;
  title: string;
  note?: string;
  /** The frame's real width — 320px for a Control Panel state. */
  bodyClassName: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={`dev-frame-${slug}`} className="flex flex-col gap-2">
      <h3 className="text-md font-semibold">{title}</h3>
      {note ? <p className="max-w-[46ch] text-sm leading-body text-vm-ink-2">{note}</p> : null}
      <div data-dev-frame-body="" className={cn("shrink-0 overflow-hidden", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

/** The 320px column a Control Panel state lives in, panel background included. */
const PANEL_FRAME = "w-[var(--panel-width)] bg-vm-panel p-3";

function ChoosingFrame({ initialSearch = "" }: { initialSearch?: string }) {
  const [search, setSearch] = useState(initialSearch);
  const [category, setCategory] = useState<string>(ALL_CATEGORIES);
  const [applied, setApplied] = useState<string | undefined>(undefined);

  return (
    <ChoosingPanel
      vmId={VM_HEADLINE}
      search={search}
      onSearchChange={setSearch}
      category={category}
      onCategoryChange={setCategory}
      appliedAnimationId={applied}
      onPick={setApplied}
    />
  );
}

function TuningFrame({
  animationId,
  fromAuto = false,
}: {
  animationId: string;
  /** As opened from the auto-generate result list: renders the "‹" control. */
  fromAuto?: boolean;
}) {
  const entry = getCatalogEntry(animationId);
  const [assignment, setAssignment] = useState<Assignment | undefined>(() =>
    sampleAssignment(animationId),
  );

  if (!entry || !assignment) {
    return <p className="text-sm text-vm-ink-2">{missingEntryNote(animationId)}</p>;
  }

  return (
    <TuningPanel
      vmId={VM_HEADLINE}
      entry={entry}
      assignment={assignment}
      // The early return above is what guarantees there is one to update; the
      // setters still say so, because React may call them at any time.
      onTriggerChange={(trigger) =>
        setAssignment((current) => (current ? { ...current, trigger } : current))
      }
      onParamChange={(key, value) =>
        setAssignment((current) =>
          current ? { ...current, params: { ...current.params, [key]: value } } : current,
        )
      }
      // Opened from the result list: the "‹" control is there to go back up to it.
      onBack={fromAuto ? () => undefined : undefined}
    />
  );
}

function ToastFrame() {
  const { toast } = useToast();

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg bg-vm-canvas p-5">
      {/* Standing, so it is in every screenshot; the real one is on a ~2s timer. */}
      <ToastPill>Saved v6</ToastPill>
      <Button variant="secondary" size="sm" onClick={() => toast("Saved v6")}>
        Show a toast for real
      </Button>
    </div>
  );
}

function EntryErrorFrame() {
  const failureId = useId();

  return (
    <div className="flex flex-col gap-3">
      <CloneFailureNotice id={failureId} failure={SAMPLE_FAILURE} />
      <OtherCloneFailureReasons />
    </div>
  );
}

function SaveDialogFrame() {
  const [label, setLabel] = useState(SAMPLE_DIFF.label);

  return (
    <StaticDialog className={SAVE_DIALOG_WIDTH}>
      <SaveDialogContent
        nextVersionLabel="v6"
        fromVersionLabel="v5"
        label={label}
        onLabelChange={setLabel}
        changes={SAMPLE_DIFF.rows}
        onCancel={() => undefined}
        // Explicit, not inherited: this frame is a picture of the dialog, and
        // its primary must not look like it would write a version.
        saveDisabled
      />
    </StaticDialog>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex flex-wrap items-start gap-8">{children}</div>
    </section>
  );
}

/**
 * `/dev` — every state of the editor's UI on one page, at its real width, so
 * it can be read against the Claude Design mocks without driving the app there.
 *
 * Deliberately store-free: every frame renders a presentational component from
 * props with local `useState` where it needs to react, so the gallery can never
 * leak a sample draft into `useEditorStore` (the store-connected `ControlPanel`
 * is the editor's, not this page's). Nothing here calls the API either.
 */
export function DevGallery() {
  return (
    <div className="flex flex-col gap-12 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Vibe Motion · UI states</h1>
        <p className="max-w-[70ch] text-md leading-body text-vm-ink-2">
          Dev-only route, 404 in production. Each frame is rendered from props at its real width —
          nothing here reads or writes the editor store, and nothing calls the API.
        </p>
        {/* Its own page: the version list, the viewing banner and the conflict
            dialog need a project's worth of history to stand in a frame. */}
        <p className="text-md leading-body text-vm-ink-2">
          The History tab&rsquo;s states live on{" "}
          <Link href="/dev/history" className="font-medium text-vm-accent hover:underline">
            /dev/history
          </Link>
          .
        </p>
      </header>

      <Group title="Control Panel">
        <Frame
          slug="panel-idle-empty"
          title="Idle · nothing animated yet"
          bodyClassName={PANEL_FRAME}
        >
          <IdlePanel assignments={{}} prompt="" onPromptChange={noop} onAutoGenerate={noop} />
        </Frame>

        <Frame
          slug="panel-idle-assignments"
          title="Idle · with assignments"
          note="The ANIMATED list and Replay all appear once the draft holds anything."
          bodyClassName={PANEL_FRAME}
        >
          <IdlePanel
            assignments={DRAFT_STATE}
            prompt=""
            onPromptChange={noop}
            onAutoGenerate={noop}
            onReplayAll={noop}
          />
        </Frame>

        <Frame
          slug="panel-idle-generating"
          title="Idle · auto-generate running"
          note="One run at a time: the button says so and takes no clicks."
          bodyClassName={PANEL_FRAME}
        >
          <IdlePanel
            assignments={{}}
            prompt="calm, staggered entrances, nothing loops"
            onPromptChange={noop}
            onAutoGenerate={noop}
            busy
          />
        </Frame>

        <Frame
          slug="panel-idle-error"
          title="Idle · auto-generate found nothing"
          note="A failed run leaves the draft untouched and says why under the button."
          bodyClassName={PANEL_FRAME}
        >
          <IdlePanel
            assignments={{}}
            prompt=""
            onPromptChange={noop}
            onAutoGenerate={noop}
            error="no-targets"
          />
        </Frame>

        <Frame
          slug="panel-selected"
          title="Selected · no animation yet"
          bodyClassName={PANEL_FRAME}
        >
          <SelectedPanel vmId={VM_HEADLINE} onGenerate={noop} />
        </Frame>

        <Frame
          slug="panel-choosing"
          title="Choosing"
          note="Search and category are live; hovering a card plays the catalog's real keyframes."
          bodyClassName={PANEL_FRAME}
        >
          <ChoosingFrame />
        </Frame>

        <Frame
          slug="panel-choosing-empty-search"
          title="Choosing · nothing matches"
          bodyClassName={PANEL_FRAME}
        >
          <ChoosingFrame initialSearch="zzz" />
        </Frame>

        <Frame
          slug="panel-tuning-distance"
          title="Tuning · an entry with distance"
          bodyClassName={PANEL_FRAME}
        >
          <TuningFrame animationId="fade-in-up" />
        </Frame>

        <Frame
          slug="panel-tuning-scale"
          title="Tuning · an entry with scale"
          bodyClassName={PANEL_FRAME}
        >
          <TuningFrame animationId="pulse" />
        </Frame>

        <Frame
          slug="panel-tuning-selects"
          title="Tuning · an entry with direction"
          note="Direction and Fill mode take the easing row's select: their CSS keywords are too long to read in a quarter of the panel."
          bodyClassName={PANEL_FRAME}
        >
          <TuningFrame animationId="spin" />
        </Frame>

        <Frame
          slug="panel-tuning-from-auto"
          title="Tuning · opened from the result list"
          note="The ‹ control appears only here: it goes back up to the auto-generate result list."
          bodyClassName={PANEL_FRAME}
        >
          <TuningFrame animationId="fade-in-up" fromAuto />
        </Frame>

        <Frame
          slug="panel-auto-result"
          title="Auto-generate result"
          note="One row per element of the last run; a row tuned by hand since keeps its place with a quiet “edited” tag."
          bodyClassName={PANEL_FRAME}
        >
          <AutoResultPanel
            rows={AUTO_RESULT_ROWS}
            prompt="calm, staggered entrances, nothing loops"
            skippedCount={4}
            truncated={false}
            consideredLimit={200}
            onSelectRow={() => undefined}
            onRegenerate={() => undefined}
            onReplayAll={() => undefined}
            onRemoveAll={() => undefined}
            onClose={() => undefined}
          />
        </Frame>
      </Group>

      <Group title="Dialogs and toast">
        <Frame
          slug="dialog-unsaved-guard"
          title="Unsaved guard · 380px"
          note="Staged inline on the scrim: the real one is a portalled modal."
          bodyClassName="w-[440px]"
        >
          <StaticDialog className={UNSAVED_GUARD_DIALOG_WIDTH}>
            <UnsavedGuardDialogContent
              elementLabel={VM_HEADLINE}
              animationName={getCatalogEntry("fade-in-up")?.name}
              currentVersionLabel="v5"
              onDiscard={() => undefined}
              onKeepEditing={() => undefined}
              saveDisabled
            />
          </StaticDialog>
        </Frame>

        <Frame
          slug="dialog-unsaved-guard-many"
          title="Unsaved guard · more than one element"
          note="Discard reverts the whole draft, so past one element the question stops naming one and counts them."
          bodyClassName="w-[440px]"
        >
          <StaticDialog className={UNSAVED_GUARD_DIALOG_WIDTH}>
            <UnsavedGuardDialogContent
              unsavedElementCount={2}
              currentVersionLabel="v5"
              onDiscard={() => undefined}
              onKeepEditing={() => undefined}
              saveDisabled
            />
          </StaticDialog>
        </Frame>

        <Frame
          slug="dialog-save"
          title="Save dialog · 420px"
          note="Label and rows come from summariseDiff over a sample saved state and draft."
          bodyClassName="w-[480px]"
        >
          <SaveDialogFrame />
        </Frame>

        <Frame
          slug="toast"
          title="Toast"
          note="The pill on the left always shows; the button fires the real, self-dismissing one."
          bodyClassName="w-[280px]"
        >
          <ToastFrame />
        </Frame>
      </Group>

      <Group title="Entry">
        <Frame
          slug="entry-cloning"
          title="Cloning"
          note="Elapsed seconds are fixed here; the real card counts."
          bodyClassName="w-[560px]"
        >
          <CloningCard
            label="nimbus.app/pricing"
            elapsedSeconds={4}
            slowHint={false}
            onCancel={() => undefined}
          />
        </Frame>

        <Frame
          slug="entry-error"
          title="Clone failed"
          note="One failure of the set lib/…/clone-failure.ts maps API codes onto."
          bodyClassName="w-[560px]"
        >
          <EntryErrorFrame />
        </Frame>
      </Group>
    </div>
  );
}
