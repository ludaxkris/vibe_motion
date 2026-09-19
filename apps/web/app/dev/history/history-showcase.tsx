"use client";

import { useState, type ReactNode } from "react";

import { ConflictDialogContent } from "@/components/dialogs/conflict-dialog";
import { UNSAVED_GUARD_DIALOG_WIDTH } from "@/components/dialogs/unsaved-guard-dialog";
import { HistoryList } from "@/components/history/history-list";
import { ViewingBanner } from "@/components/history/viewing-banner";
import type { Assignment, EditorStateMap, Trigger, Version } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";

import { StaticDialog } from "../static-dialog";

/** A draft assignment at the catalog's own defaults, or `undefined` when the id has gone. */
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

function diffOf(set: ReadonlyArray<readonly [string, string, Trigger?]>, remove: string[] = []) {
  const state: EditorStateMap = {};
  for (const [vmId, animationId, trigger] of set) {
    const assignment = sampleAssignment(animationId, trigger);
    if (assignment) state[vmId] = assignment;
  }
  return { set: state, remove };
}

function version(
  seq: number,
  label: string,
  set: ReadonlyArray<readonly [string, string, Trigger?]>,
  remove: string[] = [],
): Version {
  return {
    id: `dev-v${seq}`,
    projectId: "dev-project",
    parentVersionId: seq === 0 ? null : `dev-v${seq - 1}`,
    seq,
    label,
    catalogVersion: CURRENT_CATALOG_VERSION,
    diff: diffOf(set, remove),
    // Fixed, so the gallery's relative times ("2h ago") never drift with the clock.
    createdAt: new Date(Date.UTC(2026, 8, 14 + seq, 9, 0, 0)).toISOString(),
  };
}

/** v0 → v4, the same shape the Save flow would build one Save at a time. */
const VERSIONS: Version[] = [
  version(0, "Cloned", []),
  version(1, "Fade In Up on h1", [["h1", "fade-in-up"]]),
  version(2, "Slide In on 3 plan cards", [
    ["h1", "fade-in-up"],
    [".plan-1", "slide-in-up"],
    [".plan-2", "slide-in-up"],
    [".plan-3", "slide-in-up"],
  ]),
  version(
    3,
    "removed Slide In on .plan-2",
    [
      ["h1", "fade-in-up"],
      [".plan-1", "slide-in-up"],
      [".plan-3", "slide-in-up"],
    ],
    [".plan-2"],
  ),
  version(4, "Pulse on .cta", [
    ["h1", "fade-in-up"],
    [".plan-1", "slide-in-up"],
    [".plan-3", "slide-in-up"],
    [".cta", "pulse"],
  ]),
];

const CURRENT_VERSION_ID = "dev-v4";

/** What a save that lost the 409 race would carry: it names the version that won. */
const CONFLICT_THEIRS = version(5, "Pulse on .cta, retriggered on hover", [
  ["h1", "fade-in-up"],
  [".plan-1", "slide-in-up"],
  [".plan-3", "slide-in-up"],
  [".cta", "pulse", "hover"],
]);

/** The gallery's fixed "now", so every relative timestamp is deterministic. */
const NOW = new Date(Date.UTC(2026, 8, 18, 12, 0, 0));

function Frame({
  slug,
  title,
  note,
  children,
}: {
  slug: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section data-testid={`dev-frame-${slug}`} className="flex flex-col gap-2">
      <h3 className="text-md font-semibold">{title}</h3>
      {note ? <p className="max-w-[46ch] text-sm leading-body text-vm-ink-2">{note}</p> : null}
      <div className="w-[var(--panel-width)] shrink-0 overflow-hidden bg-vm-panel">{children}</div>
    </section>
  );
}

function HistoryListFrame({ initialViewingId }: { initialViewingId: string | null }) {
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(initialViewingId);

  return (
    <HistoryList
      versions={VERSIONS}
      currentVersionId={CURRENT_VERSION_ID}
      viewingVersionId={viewingVersionId}
      now={NOW}
      elementCount={42}
      onView={(id) => setViewingVersionId((current) => (current === id ? null : id))}
      onRestore={() => undefined}
    />
  );
}

/**
 * `/dev/history` — the History tab's presentational pieces at their real
 * width, for reading against the Claude Design mocks: the list closed, the
 * list with a past version open, the floating "viewing" banner, and the 409
 * conflict dialog. Store-free, like the rest of `/dev`: nothing here reads or
 * writes `useEditorStore`, and nothing calls the API.
 */
export function HistoryShowcase() {
  return (
    <div className="flex flex-col gap-12 p-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Vibe Motion · History</h1>
        <p className="max-w-[70ch] text-md leading-body text-vm-ink-2">
          Dev-only route, 404 in production. Presentational only — click a row to expand it, same
          as the real History tab, but nothing here is wired to the store or the API.
        </p>
      </header>

      <Frame slug="history-list" title="History list · nothing viewed">
        <HistoryListFrame initialViewingId={null} />
      </Frame>

      <Frame
        slug="history-list-viewing"
        title="History list · v3 viewed"
        note="Expands into that version's own diff, a Restore button and a disabled Export; the footer names every version a restore would leave standing."
      >
        <HistoryListFrame initialViewingId="dev-v3" />
      </Frame>

      <section data-testid="dev-frame-viewing-banner" className="flex flex-col gap-2">
        <h3 className="text-md font-semibold">Viewing banner</h3>
        <div className="flex w-[440px] items-center justify-center rounded-lg bg-vm-canvas p-6">
          <ViewingBanner
            viewingLabel="v3"
            currentLabel="v4"
            nextLabel="v5"
            onRestore={() => undefined}
            onBack={() => undefined}
          />
        </div>
      </section>

      <section data-testid="dev-frame-conflict-dialog" className="flex flex-col gap-2">
        <h3 className="text-md font-semibold">Conflict dialog · 380px</h3>
        <p className="max-w-[46ch] text-sm leading-body text-vm-ink-2">
          Staged inline on the scrim: the real one is a portalled modal, same as the unsaved guard.
        </p>
        <div className="w-[440px]">
          <StaticDialog className={UNSAVED_GUARD_DIALOG_WIDTH}>
            <ConflictDialogContent
              theirs={CONFLICT_THEIRS}
              onRebase={() => undefined}
              onDiscard={() => undefined}
              onCancel={() => undefined}
            />
          </StaticDialog>
        </div>
      </section>
    </div>
  );
}
