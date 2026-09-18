"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";

import { ControlPanel } from "@/components/control-panel";
import { Button } from "@/components/ui/button";
import { apiClient, type Project } from "@/lib/api-client";
import { previewPageUrl } from "@/lib/preview-url";
import { useEditorStore } from "@/lib/store";

import { SplitPane } from "./split-pane";

/** Thrown by `fetchProject` so the shell can tell a 404 apart from any other failure. */
class ProjectFetchError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ProjectFetchError";
  }
}

async function fetchProject(projectId: string): Promise<Project> {
  const { data, error, response } = await apiClient.GET("/projects/{projectId}", {
    params: { path: { projectId } },
  });
  if (error) {
    throw new ProjectFetchError(response.status, error.message);
  }
  return data;
}

/**
 * `/p/[projectId]` client shell: loads the project, then hosts the preview
 * iframe (left) and the Control Panel (right) behind a resizable split.
 */
export function EditorShell({ projectId }: { projectId: string }) {
  const reset = useEditorStore((state) => state.reset);
  const unsaved = useEditorStore((state) => state.unsaved);

  // A fresh project means a fresh draft: the previous project's selection and
  // client-side draft must not leak across navigations.
  useEffect(() => {
    reset();
  }, [projectId, reset]);

  const query = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => fetchProject(projectId),
    retry: false,
  });

  if (query.isPending) {
    return (
      <div
        role="status"
        aria-label="Loading project"
        className="flex flex-1 items-center justify-center"
      >
        <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
      </div>
    );
  }

  if (query.isError) {
    const isNotFound =
      query.error instanceof ProjectFetchError && query.error.status === 404;

    if (isNotFound) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">No project found for this link.</p>
          <Link href="/" className="text-sm underline underline-offset-4">
            Start a new project
          </Link>
        </div>
      );
    }

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-destructive">Could not load this project.</p>
        <Button variant="outline" size="sm" onClick={() => query.refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  const project = query.data;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{project.title}</span>
          <span className="truncate text-xs text-muted-foreground">{project.sourceUrl}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {unsaved ? "Unsaved changes" : "No unsaved changes"}
          </span>
          {/* Version history (Phase 6) is what makes Save meaningful; wired dead for now. */}
          <Button size="sm" disabled>
            Save
          </Button>
        </div>
      </div>
      <SplitPane
        left={(isDragging) => (
          <section
            aria-label="Preview"
            className="flex min-w-0 flex-1 flex-col overflow-hidden p-4"
          >
            <iframe
              title="Cloned page preview"
              src={previewPageUrl(projectId)}
              // No `allow-scripts`: the postMessage bridge script arrives in
              // Phase 4. `allow-same-origin` lets the fixture/cloned page's
              // relative assets resolve.
              sandbox="allow-same-origin"
              className="size-full rounded-lg border-0 bg-background"
              style={isDragging ? { pointerEvents: "none" } : undefined}
            />
          </section>
        )}
        right={
          <aside aria-label="Control Panel" className="h-full border-l">
            <ControlPanel />
          </aside>
        }
      />
    </div>
  );
}
