import { EditorShell } from "@/components/editor/editor-shell";

type EditorPageProps = {
  params: Promise<{ projectId: string }>;
};

/**
 * Editor route. Server Component shell; `EditorShell` is the client boundary
 * that loads the project, hosts the preview iframe, and the resizable split
 * with the Control Panel (docs/build_plan.md: ~75% preview / ~25% Control
 * Panel, clamped to 20-30%). The postMessage bridge lands in Phase 4.
 */
export default async function EditorPage({ params }: EditorPageProps) {
  const { projectId } = await params;

  // Minimal landmark until Task 8 re-skins this screen: `app/layout.tsx` no
  // longer wraps pages in `<main>` (the top bar has to stay a banner).
  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <EditorShell projectId={projectId} />
    </main>
  );
}
