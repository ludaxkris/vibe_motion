import { ControlPanel } from "@/components/control-panel";

type EditorPageProps = {
  params: Promise<{ projectId: string }>;
};

/**
 * Editor shell (wireframe).
 *
 * Split layout from docs/build_plan.md: ~75% preview, ~25% Control Panel,
 * clamped to 20–30%. The draggable resizer is Phase 3; the iframe gets its
 * `src` (the API's `/projects/{id}/page`) and the postMessage bridge in Phase 4.
 */
export default async function EditorPage({ params }: EditorPageProps) {
  const { projectId } = await params;

  return (
    <div className="flex min-h-0 flex-1">
      <section
        aria-label="Preview"
        className="flex min-w-0 flex-1 flex-col gap-2 p-4"
      >
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Preview</span>
          <span className="font-mono">project {projectId}</span>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border border-dashed bg-muted/30">
          <iframe
            title="Cloned page preview"
            className="size-full border-0 bg-transparent"
          />
          <p className="pointer-events-none absolute text-sm text-muted-foreground">
            The cloned page renders here (Phase 4).
          </p>
        </div>
      </section>
      <aside
        aria-label="Control Panel"
        className="w-[clamp(20%,25%,30%)] shrink-0 border-l"
      >
        <ControlPanel />
      </aside>
    </div>
  );
}
