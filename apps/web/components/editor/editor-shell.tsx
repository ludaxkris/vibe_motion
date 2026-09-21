"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";

import { ControlPanel } from "@/components/control-panel";
import { useVersionHistory } from "@/components/history/use-version-history";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import { autoGeneratePage, generateForElement } from "@/lib/agent/run";
// `Version` is no longer named here: the versions list moved to
// `useProjectVersions` / `lib/versions/queries.ts` (Phase 6).
import { apiClient, type Assignment, type Project } from "@/lib/api-client";
import { env } from "@/lib/env";
import { atLeast, ELEMENTS_QUERY_MIN_BRIDGE } from "@/lib/bridge";
import { useBridge } from "@/lib/bridge/use-bridge";
import { previewIsSameOrigin, previewOrigin, previewPageUrl } from "@/lib/preview-url";
import { forgetRecentProject, rememberRecentProject } from "@/lib/recent-projects";
import { hostAndPath } from "@/lib/source-url";
import { useEditorStore, useUnsaved } from "@/lib/store";

import { ElementSwitchGuard } from "./element-switch-guard";
import { SaveFlowDialogs } from "./save-flow-dialogs";
import { SplitPane } from "./split-pane";
import { useProjectVersions } from "./use-project-versions";
import { useSaveFlow } from "./use-save-flow";
import { VersionLoadErrorBanner } from "./version-load-error-banner";
import { ViewingOverlay } from "./viewing-overlay";

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
    <span
      data-testid="unsaved-indicator"
      className="flex shrink-0 items-center gap-[5px] text-xs text-vm-bar-ink-muted"
    >
      <span aria-hidden="true" className="size-[7px] rounded-full bg-vm-bar-dot" />
      Unsaved
    </span>
  );
}

/** Module-scope so React strict mode's double effect does not say it twice. */
let warnedAboutSameOrigin = false;

/**
 * Shown when the framed page speaks a protocol this build does not know
 * (spec D7). The shell has stopped sending altogether by then, so the preview
 * is frozen and the only honest instruction is to reload.
 */
function VersionMismatchBanner() {
  return (
    <div
      role="alert"
      className="flex items-center gap-2 border-b border-vm-border bg-vm-accent-tint px-4 py-2 text-sm text-vm-ink"
    >
      <span>
        This preview is running a newer version of Vibe Motion than this tab. Reload the page to
        pick it up.
      </span>
      <Button
        variant="secondary"
        size="xs"
        className="ml-auto"
        onClick={() => window.location.reload()}
      >
        Reload
      </Button>
    </div>
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
 * and live preview come over the bridge mounted on that iframe
 * (`lib/bridge/use-bridge.ts`); Save runs the flow in `use-save-flow.ts`,
 * which is the only thing on this screen that may create a version.
 */
export function EditorShell({ projectId }: { projectId: string }) {
  const reset = useEditorStore((state) => state.reset);
  const revertDraft = useEditorStore((state) => state.revertDraft);
  const dispatchPanel = useEditorStore((state) => state.dispatchPanel);
  const unsaved = useUnsaved();

  // Both derived from the same place, so the `src` the browser loads and the
  // origin every message is checked against can never disagree (spec §2).
  const previewSrc = useMemo(() => previewPageUrl(projectId), [projectId]);
  const expectedOrigin = useMemo(() => previewOrigin(projectId), [projectId]);
  // `allow-scripts allow-same-origin` is only safe while the frame is
  // cross-origin with this document; the shell checks rather than assuming.
  const sameOrigin = useMemo(() => previewIsSameOrigin(projectId), [projectId]);
  const refusesToFrame = sameOrigin && !env.apiMocking;

  useEffect(() => {
    if (!sameOrigin || !env.apiMocking || warnedAboutSameOrigin) return;
    warnedAboutSameOrigin = true;
    // Dev only, and the framed document is this repo's own fixture rather
    // than an untrusted clone, so it keeps working — but the origin check the
    // mock exists to exercise is not being exercised (DT-129).
    console.warn(
      "Vibe Motion: the preview frame is same-origin with the editor. Open the app on " +
        "http://localhost or http://127.0.0.1 so mock mode frames the other loopback host.",
    );
  }, [sameOrigin]);
  const { frameRef, handleFrameLoad, status, client } = useBridge({ expectedOrigin });
  const bridgeReady = client !== null && status === "ready";
  // Deploy skew: an older api image serves a bridge that cannot list elements.
  // Disabled buttons, rather than a failure on every click.
  const canQuery = bridgeReady && atLeast(client.bridgeVersion(), ELEMENTS_QUERY_MIN_BRIDGE);

  const handlePreview = useCallback(
    (vmId: string, assignment: Assignment) => client?.preview(vmId, assignment),
    [client],
  );
  const handleClearPreview = useCallback(() => client?.clearPreview(), [client]);
  const handleReplay = useCallback(
    (vmId: string | null) => {
      // `replay()` flushes the client's coalescing frame itself, so a draft
      // change made in this same turn is already on its way and `postMessage`
      // ordering does the rest — no ack round trip needed.
      //
      // The rejection is caught rather than left to `void`: a refused post
      // (destroyed, not ready, no frame) and a `settleAll` from a reload both
      // reject this promise, and `.then()` would adopt that rejection into a
      // promise nobody handles.
      client?.replay(vmId).catch(() => {});
    },
    [client],
  );
  // The mock agent's two runs (Phase 5). `useEditorStore` is the hook *and*
  // the store handle, the same object `useBridge` gives the client, so the run
  // writes the draft this client is subscribed to. Neither ever rejects, and
  // neither calls the API: a run only fills the client-side draft.
  const handleGenerateElement = useCallback(
    (vmId: string) =>
      client
        ? generateForElement({ store: useEditorStore, bridge: client }, vmId)
        : Promise.resolve({ ok: false, reason: "query-failed" } as const),
    [client],
  );
  const handleAutoGeneratePage = useCallback(
    (opts?: { regenerate?: boolean }) =>
      client
        ? autoGeneratePage({ store: useEditorStore, bridge: client }, opts)
        : Promise.resolve({ ok: false, reason: "query-failed" } as const),
    [client],
  );

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
  // browser saves one. The same hook forks the draft from that version's
  // state when the project opens.
  const project = query.data;
  const { currentVersionLabel, nextVersionLabel, loadError, retryLoad } = useProjectVersions(
    projectId,
    project,
  );
  const { requestSave, dialogs } = useSaveFlow(projectId, {
    currentVersionLabel,
    nextVersionLabel,
    retryLoad,
  });
  // Mounted here, not in the History tab: the tab's rows and the preview's
  // banner offer the same Restore, so they have to share one hook — and one
  // `restoring` flag (`components/history/use-version-history.ts`).
  const history = useVersionHistory(projectId, {
    currentVersionLabel,
    nextVersionLabel,
    enabled: project !== undefined,
  });
  const { viewing, back } = history;

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
      // Viewing is read-only, so there is no selection to drop: Esc is the
      // way back to the current version (docs/user_flow.md §4).
      if (viewing) {
        back();
        return;
      }
      dispatchPanel({ type: "DESELECT" });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // `back` is stable; `history` itself is a fresh object every render and
    // would re-bind this listener on each one.
  }, [unsaved, dispatchPanel, viewing, back]);

  // The draft lives in this tab and nowhere else until Save writes a version
  // (CLAUDE.md rule 9), so a reload or a closed tab is the one way to lose it
  // that no dialog of ours can stand in front of — hence the browser's own
  // (docs/user_flow.md §3, "unsaved indicator and beforeunload warning").
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

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

  return (
    <EditorFrame
      title={hostAndPath(loaded.sourceUrl)}
      heading={`Editing ${hostAndPath(loaded.sourceUrl)}`}
      chip={currentVersionLabel}
      status={unsaved ? <UnsavedIndicator /> : null}
      actions={
        <>
          <HelpLink />
          {/* docs/user_flow.md §6, "viewing vN": controls disabled, Save
              hidden. A read-only screen has no draft to cancel and nothing of
              its own to save, so neither control is rendered at all — the
              banner over the preview carries Restore and Back instead. */}
          {viewing ? null : (
            <>
              <Button variant="bar-outline" disabled={!unsaved} onClick={revertDraft}>
                Cancel
              </Button>
              {/* The rejection is the user cancelling the dialog, and is nobody's
                  news: `requestSave` reports it that way to the guards. */}
              <Button
                variant="bar-primary"
                disabled={!unsaved}
                onClick={() => void requestSave().catch(() => {})}
              >
                Save
              </Button>
            </>
          )}
        </>
      }
    >
      {status === "version-mismatch" ? <VersionMismatchBanner /> : null}
      {loadError ? <VersionLoadErrorBanner message={loadError} onRetry={retryLoad} /> : null}

      <SplitPane
        left={(isDragging) => (
          <section
            aria-label="Preview"
            // The handoff's canvas inset: 16px on three sides, none at the
            // bottom — the sheet runs off the bottom of the window.
            className="flex min-w-0 flex-1 flex-col overflow-hidden p-4 pb-0"
          >
            {/* `relative`: the viewing overlay covers this sheet and nothing else. */}
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-t-lg bg-vm-surface shadow-sheet">
              {refusesToFrame ? (
                <div
                  role="alert"
                  data-testid="preview-origin-refused"
                  className="flex size-full flex-col items-center justify-center gap-2 p-8 text-center"
                >
                  <p className="text-md text-vm-danger">
                    The preview cannot be shown from this address.
                  </p>
                  <p className="max-w-prose text-sm text-vm-ink-2">
                    The cloned page would be served from the same origin as the editor, which
                    would let it reach into this page. Serve the API from its own origin.
                  </p>
                </div>
              ) : (
              <iframe
                ref={frameRef}
                title="Cloned page preview"
                src={previewSrc}
                onLoad={handleFrameLoad}
                // `allow-scripts` runs the bridge; `allow-same-origin` keeps
                // the framed document on the origin it was served from rather
                // than the unique opaque one a bare `sandbox` gives it. An
                // opaque origin would cost everything origin-derived: `Origin:
                // null` on its requests, `script-src 'self'` matching nothing,
                // and a `postMessage` whose `event.origin` is the string
                // "null" and so cannot be checked against anything (spec §5).
                //
                // The pair is only safe while the framed page is *not*
                // same-origin with this document: together on a same-origin
                // frame they let it reach into this one, remove its own
                // sandbox attribute and reload itself unsandboxed. That is
                // checked rather than assumed — `previewIsSameOrigin` above
                // refuses to render this iframe at all outside mock mode, and
                // warns inside it (the framed document there is this repo's
                // own fixture, never an untrusted clone). In a real
                // deployment the page comes from the API's own origin, and in
                // mock mode from this machine's *other* loopback name
                // (`lib/preview-url.ts`, spec §2).
                sandbox="allow-scripts allow-same-origin"
                className="size-full border-0 bg-vm-surface"
                // While viewing, the frame shows `stateAt(vN)` and there is
                // nothing on it to select: the overlay covers it, and this
                // makes sure nothing reaches it even if that layer moves.
                style={isDragging || viewing ? { pointerEvents: "none" } : undefined}
                // The keyboard's half of the same fact — Tab must not walk
                // into the clone behind the overlay. On the frame itself, not
                // on the sheet around it: the banner is that sheet's child,
                // and an inert sheet would take its buttons with it.
                inert={viewing}
              />
              )}
              {/* The white 45% layer and the "Viewing v3 · read-only" pill,
                  over the preview only (`docs/design/README.md`). */}
              <ViewingOverlay history={history} />
            </div>
          </section>
        )}
        right={
          <aside aria-label="Control Panel" className="h-full bg-vm-panel">
            {/* The guard's "…or discard to leave v5 as is" needs the version
                the draft forked from, which only the versions list knows. */}
            <ControlPanel
              projectId={projectId}
              // The Export tab's downloads are named after the project
              // (`vibe-motion-<slug>-v<seq>.zip`); nothing else sees the title.
              projectTitle={loaded.title}
              currentVersionLabel={currentVersionLabel}
              history={history}
              onSave={requestSave}
              // Gated on the handshake, not merely on the client existing:
              // while `connecting` or `version-mismatch` the client refuses
              // every post, so an enabled Replay, live card hovers and the
              // generate buttons would be controls that silently do nothing.
              onPreview={bridgeReady ? handlePreview : undefined}
              onClearPreview={bridgeReady ? handleClearPreview : undefined}
              onReplay={bridgeReady ? handleReplay : undefined}
              onGenerateElement={canQuery ? handleGenerateElement : undefined}
              onAutoGeneratePage={canQuery ? handleAutoGeneratePage : undefined}
            />
          </aside>
        }
      />

      {/* The guard on switching elements inside the preview. Mounted here, not
          in the Control Panel, because the click that raises it comes from the
          iframe this screen owns. DT-099 tracks folding the two mountings into
          one. */}
      <ElementSwitchGuard currentVersionLabel={currentVersionLabel} onSave={requestSave} />

      {/* The Save dialog and the 409's rebase/discard question, driven by
          `useSaveFlow` — the only thing here that may create a version. */}
      <SaveFlowDialogs {...dialogs} />
    </EditorFrame>
  );
}
