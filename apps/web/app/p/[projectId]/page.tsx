import { EditorShell } from "@/components/editor/editor-shell";

type EditorPageProps = {
  params: Promise<{ projectId: string }>;
};

/**
 * Editor route. Server Component shell; `EditorShell` is the client boundary
 * that loads the project, hosts the preview iframe, and the resizable split
 * with the Control Panel (docs/build_plan.md: ~75% preview / ~25% Control
 * Panel, clamped to 20-30%). It owns the screen's own chrome — the top bar is
 * a banner and therefore cannot live inside the page's `<main>`, so neither is
 * in `app/layout.tsx`. The postMessage bridge lands in Phase 4.
 */
export default async function EditorPage({ params }: EditorPageProps) {
  const { projectId } = await params;

  return <EditorShell projectId={projectId} />;
}
