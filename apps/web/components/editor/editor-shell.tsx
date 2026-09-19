"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, type ReactNode } from "react";

import { ControlPanel } from "@/components/control-panel";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { apiClient, type Project, type Version } from "@/lib/api-client";
import { previewPageUrl } from "@/lib/preview-url";
import { forgetRecentProject, rememberRecentProject } from "@/lib/recent-projects";
import { hostAndPath } from "@/lib/source-url";
import { useEditorStore, useUnsaved } from "@/lib/store";

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

async function fetchVersions(projectId: string): Promise<Version[]> {
  const { data, error } = await apiClient.GET("/projects/{projectId}/versions", {
    params: { path: { projectId } },
  });
  if (error) throw new Error(error.message);
  return data.versions;
}

/** The screen's own chrome: the bar is a banner, so it cannot live inside `<main>`. */
function EditorFrame({
  children,
  title,
  heading,
  chip,
  status,
  actions,
}: {
  children: ReactNode;
  /** `string`, not `ReactNode`: `TopBar` intersects it with the header's own `title` attribute. */
  title?: string;
  /** The screen's `<h1>`, named for a reader who navigates by headings. */
  heading?: string;
  chip?: string;
  /** Sits in the bar after the version chip — the unsaved indicator. */
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <>
      <TopBar title={title} chip={chip} actions={actions}>
        {status}
      </TopBar>
      <main className="flex min-h-0 flex-1 flex-col bg-vm-canvas">
        {/* The project's name is in the bar, which is a banner and so cannot
            carry the page's heading (same shape as `/help`). Visually the
            chrome already says where you are, so the heading is sr-only. */}
        <h1 className="sr-only">{heading ?? "Editor"}</h1>
        {children}
      </main>
    </>
  );
}

/**
 * Whether the key belongs to whatever the user is typing in. Esc inside the
 * picker's search field clears the query; it must not also throw away the
 * selection behind the panel.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
}

/** The bar's 7px dot + caption, shown only while the draft differs from the saved version. */
function UnsavedIndicator() {
  return (
    <span className="flex shrink-0 items-center gap-[5px] text-xs text-vm-bar-ink-muted">
      <span aria-hidden="true" className="size-[7px] rounded-full bg-vm-bar-dot" />
      Unsaved
    </span>
  );
}

function HelpLink() {
  return (
    // docs/user_flow.md §2: Help opens in a new tab so the draft is untouched.
    <Link
      href="/help"
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm text-vm-bar-ink-muted transition-colors duration-(--dur-fast) ease-standard hover:text-vm-bar-ink"
    >
      Help
    </Link>
  );
}

/**
 * `/p/[projectId]` — the handoff's Editor (`docs/design/README.md` "Global
 * chrome" and "2. Editor", `docs/design/ui_kit/Editor.jsx`).
 *
 * Loads the project, then hosts the preview iframe in its white sheet (left)
 * and the Control Panel (right) behind a resizable split. Element selection
 * from inside the iframe arrives with the bridge (Phase 4); Save opens the
 * save dialog in Phase 6 and is deliberately inert here.
 */
export function EditorShell({ projectId }: { projectId: string }) {
  const reset = useEditorStore((state) => state.reset);
  const revertDraft = useEditorStore((state) => state.revertDraft);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const unsaved = useUnsaved();

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

  // The version chip is `v<seq>` of the project's current version, which only
  // the versions list carries. Fetched once the project is there (it supplies
  // the id to match) and never polled: a version appears only when this
  // browser saves one (Phase 6).
  const project = query.data;
  const versionsQuery = useQuery({
    queryKey: ["project", projectId, "versions"],
    queryFn: () => fetchVersions(projectId),
    enabled: project !== undefined,
    retry: false,
  });

  // Opening a project is what makes it recent, so the Entry screen's column
  // also lists projects reached by link or by Back (`lib/recent-projects.ts`).
  useEffect(() => {
    if (!project) return;
    rememberRecentProject({
      id: project.id,
      title: project.title,
      sourceUrl: project.sourceUrl,
    });
  }, [project]);

  // Esc deselects, but only while the draft is clean — losing unsaved work to
  // a stray keypress is exactly what the guard dialog (Phase 6) exists to
  // prevent (docs/design/README.md, "On-page selection"). Listening on the
  // window rather than inside the iframe: the iframe is a separate browsing
  // context and the bridge (Phase 4) forwards its own keys.
  //
  // Being last in line, the shell takes Esc only when nothing nearer wanted
  // it: a dialog or a popup that closed on the key calls `preventDefault`, and
  // a text field is still being typed in.
  useEffect(() => {
    if (unsaved) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (event.defaultPrevented) return;
      if (isTextEntry(event.target)) return;
      dispatchPanel({ type: "DESELECT" });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [unsaved, dispatchPanel]);

  // A 404 says the project is gone; a 400 says the id in the link was never a
  // project id at all. Both leave the reader on the same dead link, so they
  // get the same screen — and the id comes off this browser's recent list,
  // which nothing else would ever clean up (there is no list endpoint).
  const missing =
    query.error instanceof ProjectFetchError &&
    (query.error.status === 404 || query.error.status === 400);

  useEffect(() => {
    if (missing) forgetRecentProject(projectId);
  }, [missing, projectId]);

  if (query.isPending) {
    return (
      <EditorFrame actions={<HelpLink />}>
        <div
          role="status"
          aria-label="Loading project"
          className="flex flex-1 items-center justify-center"
        >
          <div className="size-6 animate-spin rounded-full border-2 border-vm-border border-t-vm-accent" />
        </div>
      </EditorFrame>
    );
  }

  if (query.isError) {
    return (
      <EditorFrame actions={<HelpLink />}>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          {missing ? (
            <>
              <p className="text-md text-vm-ink-2">No project found for this link.</p>
              <Link href="/" className="text-md font-medium text-vm-accent hover:underline">
                Start a new project
              </Link>
            </>
          ) : (
            <>
              <p className="text-md text-vm-danger">Could not load this project.</p>
              <Button variant="secondary" size="sm" onClick={() => query.refetch()}>
                Retry
              </Button>
            </>
          )}
        </div>
      </EditorFrame>
    );
  }

  const loaded = query.data;
  const currentVersion = versionsQuery.data?.find((v) => v.id === loaded.currentVersionId);

  return (
    <EditorFrame
      title={hostAndPath(loaded.sourceUrl)}
      heading={`Editing ${hostAndPath(loaded.sourceUrl)}`}
      chip={currentVersion ? `v${currentVersion.seq}` : undefined}
      status={unsaved ? <UnsavedIndicator /> : null}
      actions={
        <>
          <HelpLink />
          <Button variant="bar-outline" disabled={!unsaved} onClick={revertDraft}>
            Cancel
          </Button>
          {/* Inert until Phase 6 gives it the save dialog and POST /versions. */}
          <Button variant="bar-primary" disabled={!unsaved}>
            Save
          </Button>
        </>
      }
    >
      <SplitPane
        left={(isDragging) => (
          <section
            aria-label="Preview"
            // The handoff's canvas inset: 16px on three sides, none at the
            // bottom — the sheet runs off the bottom of the window.
            className="flex min-w-0 flex-1 flex-col overflow-hidden p-4 pb-0"
          >
            <div className="min-h-0 flex-1 overflow-hidden rounded-t-lg bg-vm-surface shadow-sheet">
              <iframe
                title="Cloned page preview"
                src={previewPageUrl(projectId)}
                // No `allow-scripts`: the postMessage bridge script arrives in
                // Phase 4. `allow-same-origin` keeps the frame on the API's
                // origin instead of the opaque one a bare `sandbox` would give
                // it — an opaque origin has no cookies, no storage and a null
                // `Origin` header, so it cannot be a postMessage peer, and
                // relative URLs in the cloned page would resolve against
                // nothing rather than against the page's own base.
                //
                // Phase 4, when the bridge script arrives: never pair
                // `allow-scripts` with `allow-same-origin` while the page is
                // served from an origin of ours — together they let the framed
                // page reach out and strip its own sandbox attribute. The
                // bridge needs its page on a separate origin first.
                sandbox="allow-same-origin"
                className="size-full border-0 bg-vm-surface"
                style={isDragging ? { pointerEvents: "none" } : undefined}
              />
            </div>
          </section>
        )}
        right={
          <aside aria-label="Control Panel" className="h-full bg-vm-panel">
            {/* The guard's "…or discard to leave v5 as is" needs the version
                the draft forked from, which only this query knows. */}
            <ControlPanel
              currentVersionLabel={currentVersion ? `v${currentVersion.seq}` : undefined}
            />
          </aside>
        }
      />
    </EditorFrame>
  );
}
