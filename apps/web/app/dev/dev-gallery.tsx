"use client";

import { getEntry } from "animation-catalog";
import { cn } from "cn";
import { useId, useState, type ReactNode } from "react";

import { ALL_CATEGORIES, ChoosingPanel } from "@/components/control-panel/choosing";
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
import type { Assignment, CatalogEntry, EditorStateMap, Trigger } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import { summariseDiff } from "@/lib/diff-summary";

import { StaticDialog } from "./static-dialog";

/**
 * Fixed `data-vm-id`s. The bridge (Phase 4) is what puts real ones on screen;
 * until then the element label *is* the id, which is what the panels show.
 */
const VM_HEADLINE = "vm-3";
const VM_CTA = "vm-9";
const VM_DROPPED = "vm-14";

/** A catalog entry the gallery pins by id; a miss means the catalog moved under it. */
function requireEntry(animationId: string): CatalogEntry {
  const entry = getCatalogEntry(animationId);
  if (!entry) {
    throw new Error(`/dev: "${animationId}" is not in catalog ${CURRENT_CATALOG_VERSION}`);
  }
  return entry;
}

/** A draft assignment at the catalog's own defaults, pinned to the current version. */
function sampleAssignment(animationId: string, trigger?: Trigger): Assignment {
  const entry = requireEntry(animationId);
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: trigger ?? entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  };
}

/** What the last saved version holds. */
const SAVED_STATE: EditorStateMap = {
  [VM_CTA]: sampleAssignment("pulse"),
  [VM_DROPPED]: sampleAssignment("shake"),
};

/** …and where the draft has got to: one added, one retriggered, one dropped. */
const DRAFT_STATE: EditorStateMap = {
  [VM_HEADLINE]: sampleAssignment("fade-in-up"),
  [VM_CTA]: sampleAssignment("pulse", "hover"),
};

const SAMPLE_DIFF = summariseDiff(SAVED_STATE, DRAFT_STATE, getEntry);

/** The handoff's showcased clone failure (`docs/design/README.md`, Entry state 3b). */
const SAMPLE_FAILURE = describeCloneFailure(
  new CloneRequestError(422, "login_required", "login required"),
);

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
const PANEL_FRAME = "w-[320px] bg-vm-panel p-3";

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

function TuningFrame({ animationId }: { animationId: string }) {
  const entry = requireEntry(animationId);
  const [assignment, setAssignment] = useState<Assignment>(() => sampleAssignment(animationId));

  return (
    <TuningPanel
      vmId={VM_HEADLINE}
      entry={entry}
      assignment={assignment}
      onTriggerChange={(trigger) => setAssignment((current) => ({ ...current, trigger }))}
      onParamChange={(key, value) =>
        setAssignment((current) => ({ ...current, params: { ...current.params, [key]: value } }))
      }
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
      </header>

      <Group title="Control Panel">
        <Frame
          slug="panel-idle-empty"
          title="Idle · nothing animated yet"
          bodyClassName={PANEL_FRAME}
        >
          <IdlePanel assignments={{}} />
        </Frame>

        <Frame
          slug="panel-idle-assignments"
          title="Idle · with assignments"
          note="The ANIMATED list and Replay all appear once the draft holds anything."
          bodyClassName={PANEL_FRAME}
        >
          <IdlePanel assignments={DRAFT_STATE} />
        </Frame>

        <Frame
          slug="panel-selected"
          title="Selected · no animation yet"
          bodyClassName={PANEL_FRAME}
        >
          <SelectedPanel vmId={VM_HEADLINE} />
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
              animationName={requireEntry("fade-in-up").name}
              currentVersionLabel="v5"
              onDiscard={() => undefined}
              onKeepEditing={() => undefined}
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
