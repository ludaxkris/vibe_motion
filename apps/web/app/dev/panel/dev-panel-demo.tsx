"use client";

import type { ReactNode } from "react";

import { ControlPanel } from "@/components/control-panel";
import { ChoosingPanel } from "@/components/control-panel/choosing";
import { IdlePanel } from "@/components/control-panel/idle";
import { SelectedPanel } from "@/components/control-panel/selected";
import { TuningPanel } from "@/components/control-panel/tuning";
import { Button } from "@/components/ui/button";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import { useEditorStore } from "@/lib/store";

/** Fixed `data-vm-id` for the static four-states gallery below. */
const GALLERY_VM_ID = "dev-vm-gallery";
const GALLERY_ANIMATION_ID = "fade-in";

/**
 * Separate `data-vm-id` for the interactive "live instance": kept apart from
 * `GALLERY_VM_ID` so pressing `SELECT` there starts clean (no pre-existing
 * draft), rather than jumping straight to `tuning` the way `SELECT` of an
 * already-assigned element does.
 */
const LIVE_VM_ID = "dev-vm-live";

/**
 * Seeds the gallery's `tuning` card draft assignment synchronously, at
 * module load — *not* in a mount effect. An effect runs after the first
 * paint, so the `tuning` card would flash `TuningPanel`'s "no draft"
 * fallback before the effect caught up; seeding here means `draftState`
 * already has it by the time `DevPanelDemo` renders for the first time.
 * Guarded and idempotent, since this module (and so this top-level call)
 * only ever runs once per process/test.
 */
function seedGalleryDraftOnce(): void {
  const store = useEditorStore.getState();
  if (store.draftState[GALLERY_VM_ID]) return;
  const entry = getCatalogEntry(GALLERY_ANIMATION_ID);
  if (!entry) return;
  store.setDraftAssignment(GALLERY_VM_ID, {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  });
}
seedGalleryDraftOnce();

function StateCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-48 flex-col gap-2 rounded-lg border p-4" data-testid={`dev-panel-card-${title}`}>
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

/**
 * `/dev/panel`: every Control Panel state side by side (a fixed fake vmId,
 * `GALLERY_VM_ID`), plus a live `ControlPanel` instance with buttons that
 * fire each `panel-machine` event, so a reviewer can see every transition
 * without wiring up the preview iframe (Phase 4).
 */
export function DevPanelDemo() {
  const draftState = useEditorStore((state) => state.draftState);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const panel = useEditorStore((state) => state.panel);

  const liveDraftAnimationId = draftState[LIVE_VM_ID]?.animationId;

  return (
    <div className="flex flex-col gap-10 p-8">
      <section>
        <h1 className="text-lg font-semibold tracking-tight">Control Panel states</h1>
        <p className="text-sm text-muted-foreground">
          Dev-only route, not reachable in production. Fixed vmId:{" "}
          <code>{GALLERY_VM_ID}</code>.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StateCard title="idle">
            <IdlePanel />
          </StateCard>
          <StateCard title="selected">
            <SelectedPanel vmId={GALLERY_VM_ID} />
          </StateCard>
          <StateCard title="choosing">
            <ChoosingPanel vmId={GALLERY_VM_ID} />
          </StateCard>
          <StateCard title="tuning">
            <TuningPanel vmId={GALLERY_VM_ID} animationId={GALLERY_ANIMATION_ID} />
          </StateCard>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold tracking-tight">Live instance</h2>
        <p className="text-sm text-muted-foreground">
          Current state: <code data-testid="dev-panel-live-status">{panel.status}</code>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              dispatchPanel({
                type: "SELECT",
                vmId: LIVE_VM_ID,
                draftAnimationId: liveDraftAnimationId,
              })
            }
          >
            SELECT
          </Button>
          <Button size="sm" variant="outline" onClick={() => dispatchPanel({ type: "DESELECT" })}>
            DESELECT
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatchPanel({ type: "CHOOSE_CUSTOM" })}
          >
            CHOOSE_CUSTOM
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => dispatchPanel({ type: "PICK", animationId: GALLERY_ANIMATION_ID })}
          >
            PICK(fade-in)
          </Button>
          <Button size="sm" variant="outline" onClick={() => dispatchPanel({ type: "BACK" })}>
            BACK
          </Button>
          <Button size="sm" variant="outline" onClick={() => dispatchPanel({ type: "CLEAR" })}>
            CLEAR
          </Button>
        </div>
        <div className="mt-4 h-[28rem] w-80 rounded-lg border">
          <ControlPanel />
        </div>
      </section>
    </div>
  );
}
