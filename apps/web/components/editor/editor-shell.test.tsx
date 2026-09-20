import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PROTOCOL_VERSION } from "bridge";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient, type Assignment, type Project, type Version } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import { env } from "@/lib/env";
import { previewOrigin } from "@/lib/preview-url";
import { readRecentProjects, rememberRecentProject } from "@/lib/recent-projects";
import { initialEditorState, selectSelectedVmId, useEditorStore } from "@/lib/store";
import { saveVersion } from "@/lib/versions/api";
import { listVersions } from "@/mocks/db";
import { server } from "@/mocks/server";

import { EditorShell } from "./editor-shell";

const api = (path: string) => `${env.apiOrigin}${path}`;

function renderShell(projectId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<EditorShell projectId={projectId} />, { wrapper: Wrapper });
}

async function createProject(): Promise<Project> {
  const { data } = await apiClient.POST("/projects", {
    body: { url: "https://example.com/pricing" },
  });
  return data as Project;
}

function assignmentFor(animationId: string): Assignment {
  const entry = getCatalogEntry(animationId)!;
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  };
}

/** The shell forks the draft from the project's current version when it opens (Phase 6). */
async function openLoaded() {
  await waitFor(() => expect(useEditorStore.getState().currentVersionId).not.toBeNull());
}

/** Puts the store in the state an element with an unsaved animation leaves it in. */
function selectAndAnimate(vmId: string, animationId = "fade-in") {
  const store = useEditorStore.getState();
  store.setSelectedVmId(vmId);
  store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
  store.dispatchPanel({ type: "PICK", animationId });
}

beforeEach(() => {
  localStorage.clear();
  useEditorStore.setState({ ...initialEditorState });
});

afterEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("EditorShell", () => {
  it("shows a loading state, with no version chip yet, while the project is being fetched", async () => {
    server.use(
      http.get(api("/projects/:projectId"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    renderShell("11111111-1111-1111-1111-111111111111");

    expect(await screen.findByRole("status", { name: /loading project/i })).toBeInTheDocument();
    expect(screen.queryByText(/^v\d+$/)).not.toBeInTheDocument();
  });

  it("shows a not-found message with a link home for an unknown project", async () => {
    renderShell("00000000-0000-0000-0000-000000000000");

    expect(await screen.findByText(/no project found/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /start a new project/i });
    expect(link).toHaveAttribute("href", "/");
  });

  it("shows the same not-found screen for a projectId the API rejects as malformed", async () => {
    // The service answers 400 `bad_request` for a path id that is not a uuid.
    // To the reader who mistyped the link that is the same story as a 404, and
    // "Could not load this project" with a Retry that can never work is not.
    renderShell("not-a-uuid");

    expect(await screen.findByText(/no project found/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /start a new project/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("gives the screen a heading of its own, for a reader who navigates by them", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("example.com/pricing");
    // The bar is a banner and cannot carry it, so it lives inside main.
    expect(within(screen.getByRole("main")).getByRole("heading", { level: 1 })).toBe(heading);
  });

  it("shows an error state with retry on a server error", async () => {
    server.use(http.get(api("/projects/:projectId"), () => HttpResponse.json({}, { status: 500 })));

    renderShell("11111111-1111-1111-1111-111111111111");

    expect(await screen.findByText(/could not load this project/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("retries the fetch when Retry is clicked", async () => {
    const project = await createProject();
    let calls = 0;
    server.use(
      http.get(api("/projects/:projectId"), () => {
        calls += 1;
        if (calls === 1) return HttpResponse.json({}, { status: 500 });
        return HttpResponse.json(project satisfies Project);
      }),
    );

    renderShell(project.id);

    fireEvent.click(await screen.findByRole("button", { name: /retry/i }));

    await waitFor(() => {
      expect(screen.getByText("example.com/pricing")).toBeInTheDocument();
    });
  });

  it("puts the top bar outside main, as a banner", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    const banner = screen.getByRole("banner");
    expect(banner).toBeInTheDocument();
    expect(within(screen.getByRole("main")).queryByRole("banner")).not.toBeInTheDocument();
  });

  it("names the project by host and path in the top bar, with the current version's chip", async () => {
    const project = await createProject();

    renderShell(project.id);

    expect(await screen.findByText("example.com/pricing")).toBeInTheDocument();
    // The mock API creates the project with version 0.
    expect(await screen.findByText("v0")).toBeInTheDocument();
  });

  it("keeps the top bar's Help link pointing at the help page, in a new tab", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    const help = screen.getByRole("link", { name: "Help" });
    expect(help).toHaveAttribute("href", "/help");
    expect(help).toHaveAttribute("target", "_blank");
  });

  it("renders the preview iframe in its sheet and the Control Panel when loaded", async () => {
    const project = await createProject();

    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    const preview = screen.getByRole("region", { name: "Preview" });
    const iframe = within(preview).getByTitle("Cloned page preview");
    expect(iframe).toHaveAttribute("src", `${env.apiOrigin}/projects/${project.id}/page`);
    // The bridge needs scripts, and the origin check needs a real origin; the
    // frame is cross-origin with the shell either way (spec §5).
    expect(iframe).toHaveAttribute("sandbox", "allow-scripts allow-same-origin");

    expect(screen.getByRole("complementary", { name: "Control Panel" })).toBeInTheDocument();
  });

  it("shows no unsaved indicator and disables Cancel and Save while the draft is clean", async () => {
    const project = await createProject();

    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("shows the unsaved indicator and enables Cancel and Save once the draft differs", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    selectAndAnimate("vm-1");

    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("Cancel reverts the draft and leaves the element selected when nothing was saved for it", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    selectAndAnimate("vm-1");

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    const state = useEditorStore.getState();
    expect(state.draftState).toEqual({});
    expect(state.panel).toEqual({ status: "selected", vmId: "vm-1" });
    await waitFor(() => expect(screen.queryByText("Unsaved")).not.toBeInTheDocument());
  });

  it("Cancel lands back on tuning when the element still has a saved animation", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    // The shell forks the draft from the project's current version when it
    // opens; this test stands a *saved* animation in that draft's place, so it
    // waits for the open load rather than racing it.
    await openLoaded();

    const saved = assignmentFor("pulse");
    useEditorStore.setState({ currentVersionState: { "vm-1": saved }, draftState: { "vm-1": saved } });
    selectAndAnimate("vm-1", "shake");

    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    const state = useEditorStore.getState();
    expect(state.draftState).toEqual({ "vm-1": saved });
    expect(state.panel).toEqual({ status: "tuning", vmId: "vm-1", animationId: "pulse" });
  });

  it("Esc deselects while the draft is clean", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    useEditorStore.getState().setSelectedVmId("vm-1");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(selectSelectedVmId(useEditorStore.getState())).toBeNull();
  });

  it("Esc does nothing while the draft is dirty", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    selectAndAnimate("vm-1");
    // The shell only stops listening once it has re-rendered as dirty.
    await screen.findByText("Unsaved");

    fireEvent.keyDown(window, { key: "Escape" });

    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-1");
  });

  it("Esc leaves a text field alone — the picker's search is where Esc clears the query", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    const store = useEditorStore.getState();
    store.setSelectedVmId("vm-1");
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });

    fireEvent.keyDown(await screen.findByRole("searchbox", { name: "Search animations" }), {
      key: "Escape",
    });

    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-1");
  });

  it("Esc that something nearer has already handled does not also deselect", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    useEditorStore.getState().setSelectedVmId("vm-1");

    // Stands in for a dialog or a popup closing on Esc: it claims the key on
    // the way up, and the shell must not act on it a second time.
    const claim = (event: Event) => event.preventDefault();
    document.body.addEventListener("keydown", claim);
    try {
      fireEvent.keyDown(document.body, { key: "Escape" });
    } finally {
      document.body.removeEventListener("keydown", claim);
    }

    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-1");
  });

  it("forgets a project it could not find, so the Entry screen stops offering it", async () => {
    const missingId = "00000000-0000-0000-0000-000000000000";
    rememberRecentProject({ id: missingId, title: "gone.test", sourceUrl: "https://gone.test/" });
    rememberRecentProject({ id: "11111111-1111-1111-1111-111111111111", title: "kept.test", sourceUrl: "https://kept.test/" });

    renderShell(missingId);
    await screen.findByText(/no project found/i);

    await waitFor(() => {
      expect(readRecentProjects().map((p) => p.id)).toEqual([
        "11111111-1111-1111-1111-111111111111",
      ]);
    });
  });

  it("keeps the recent list intact when the failure is not a missing project", async () => {
    const project = await createProject();
    rememberRecentProject({
      id: project.id,
      title: project.title,
      sourceUrl: project.sourceUrl,
    });
    server.use(http.get(api("/projects/:projectId"), () => HttpResponse.json({}, { status: 500 })));

    renderShell(project.id);
    await screen.findByText(/could not load this project/i);

    expect(readRecentProjects().map((p) => p.id)).toEqual([project.id]);
  });

  it("records the project under Recent projects once it loads", async () => {
    const project = await createProject();

    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    await waitFor(() => {
      expect(readRecentProjects()).toEqual([
        {
          id: project.id,
          title: project.title,
          sourceUrl: project.sourceUrl,
          openedAt: expect.any(String),
        },
      ]);
    });
  });

  it("does not record a project it could not load", async () => {
    renderShell("00000000-0000-0000-0000-000000000000");
    await screen.findByText(/no project found/i);

    expect(readRecentProjects()).toEqual([]);
  });

  it("resets the editor store when the project id changes", async () => {
    const projectA = await createProject();
    const projectB = await createProject();
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-something" });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const { rerender } = render(<EditorShell projectId={projectA.id} />, { wrapper: Wrapper });
    await screen.findByText("example.com/pricing");

    expect(selectSelectedVmId(useEditorStore.getState())).toBeNull();

    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-something-else" });
    rerender(<EditorShell projectId={projectB.id} />);
    await waitFor(() => expect(selectSelectedVmId(useEditorStore.getState())).toBeNull());
  });
});

describe("EditorShell bridge", () => {
  const info = (vmId: string, tag: string) => ({
    vmId,
    tag,
    role: null,
    textPreview: "",
    rect: { x: 0, y: 0, width: 10, height: 10 },
    pageRect: { x: 0, y: 0, width: 10, height: 10 },
    order: 0,
    visible: true,
  });

  /** A `ready` from the frame, with the `source` the client checks. */
  function handshake(protocolVersion: number = PROTOCOL_VERSION) {
    const frame = screen.getByTitle("Cloned page preview") as HTMLIFrameElement;
    const source = frame.contentWindow;
    if (source) vi.spyOn(source, "postMessage").mockImplementation(() => {});
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "vibe-motion",
            type: "ready",
            payload: { elementCount: 3, bridgeVersion: "1.0.0", protocolVersion },
          },
          origin: previewOrigin("ignored"),
          source,
        }),
      );
    });
  }

  it("shows a reload banner when the frame speaks a protocol this build does not know", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    handshake(PROTOCOL_VERSION + 1);

    expect(screen.getByRole("alert")).toHaveTextContent(/newer version of Vibe Motion/);
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("keeps the banner away once the frame handshakes on the protocol it knows", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    handshake();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("raises the element-switch guard when a dirty element is clicked away from", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    act(() => {
      useEditorStore.getState().rememberElement(info("vm-1", "h1"));
    });
    selectAndAnimate("vm-1");
    await screen.findByText("Unsaved");

    // What an `element:select` from inside the frame does (spec D10): it asks.
    act(() => {
      useEditorStore.getState().requestSelect("vm-2");
    });

    expect(await screen.findByText("Save changes to h1?")).toBeInTheDocument();
    // The selection has not moved.
    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-1");

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    await waitFor(() => {
      expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-2");
    });
    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("switches without a dialog while the element is clean", async () => {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    act(() => {
      useEditorStore.getState().setSelectedVmId("vm-1");
    });

    act(() => {
      useEditorStore.getState().requestSelect("vm-2");
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-2");
  });
});

describe("EditorShell bridge readiness", () => {
  async function editorWithTuning() {
    const project = await createProject();
    renderShell(project.id);
    await screen.findByText("example.com/pricing");
    act(() => {
      selectAndAnimate("vm-1");
    });
    return project;
  }

  it("keeps Replay disabled until the frame has handshaked", async () => {
    await editorWithTuning();

    // `connecting`: `post()` refuses everything, so an enabled Replay would be
    // a control that silently does nothing.
    expect(await screen.findByRole("button", { name: "Replay" })).toBeDisabled();
  });

  it("enables Replay once the bridge is ready", async () => {
    await editorWithTuning();
    const frame = screen.getByTitle("Cloned page preview") as HTMLIFrameElement;
    const source = frame.contentWindow;
    if (source) vi.spyOn(source, "postMessage").mockImplementation(() => {});

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "vibe-motion",
            type: "ready",
            payload: { elementCount: 3, bridgeVersion: "1.0.0", protocolVersion: PROTOCOL_VERSION },
          },
          origin: previewOrigin("ignored"),
          source,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Replay" })).toBeEnabled();
    });
  });

  it("disables Replay again when the frame speaks a protocol this build does not know", async () => {
    await editorWithTuning();
    const frame = screen.getByTitle("Cloned page preview") as HTMLIFrameElement;
    const source = frame.contentWindow;
    if (source) vi.spyOn(source, "postMessage").mockImplementation(() => {});

    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "vibe-motion",
            type: "ready",
            payload: {
              elementCount: 3,
              bridgeVersion: "9.0.0",
              protocolVersion: PROTOCOL_VERSION + 1,
            },
          },
          origin: previewOrigin("ignored"),
          source,
        }),
      );
    });

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
  });
});

describe("EditorShell save flow", () => {
  async function opened(projectId: string) {
    renderShell(projectId);
    await screen.findByText("example.com/pricing");
    await openLoaded();
  }

  it("forks the draft from the project's current version when it opens", async () => {
    const project = await createProject();

    await opened(project.id);

    // v0 of a fresh clone animates nothing, but the *fork* is what matters:
    // without it the first Save would diff against an empty map.
    expect(useEditorStore.getState().currentVersionId).toBe(project.currentVersionId);
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
  });

  it("opens the Save dialog from the top bar, naming the version it would create", async () => {
    const project = await createProject();
    await opened(project.id);
    selectAndAnimate("vm-1");

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    const dialog = await screen.findByRole("dialog", { name: "Save as v1" });
    expect(within(dialog).getByText("from v0")).toBeInTheDocument();
    expect(within(dialog).getByText("vm-1")).toBeInTheDocument();
  });

  it("saves, moves the version chip on and clears the unsaved indicator", async () => {
    const project = await createProject();
    await opened(project.id);
    selectAndAnimate("vm-1");
    fireEvent.click(await screen.findByRole("button", { name: "Save" }));
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    expect(await screen.findByText("v1")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Unsaved")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says so and offers a Retry when the project's saved animations will not load", async () => {
    const project = await createProject();
    server.use(
      http.get(
        api("/projects/:projectId/versions/:versionId/state"),
        () => HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
        { once: true },
      ),
    );

    renderShell(project.id);
    await screen.findByText("example.com/pricing");

    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent(/saved animations/i);

    fireEvent.click(within(banner).getByRole("button", { name: "Retry" }));

    await openLoaded();
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("offers Save in the element-switch guard, and lets the selection through once it lands", async () => {
    const project = await createProject();
    await opened(project.id);
    act(() => {
      useEditorStore.getState().rememberElement({
        vmId: "vm-1",
        tag: "h1",
        role: null,
        textPreview: "",
        rect: { x: 0, y: 0, width: 10, height: 10 },
        pageRect: { x: 0, y: 0, width: 10, height: 10 },
        order: 0,
        visible: true,
      });
    });
    selectAndAnimate("vm-1");
    await screen.findByText("Unsaved");
    act(() => {
      useEditorStore.getState().requestSelect("vm-2");
    });

    const guard = await screen.findByRole("dialog", { name: "Save changes to h1?" });
    const save = within(guard).getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    expect(screen.queryByText("Saving arrives with version history.")).not.toBeInTheDocument();

    fireEvent.click(save);
    fireEvent.click(await screen.findByRole("button", { name: "Save version" }));

    // The guard only lets the pending selection through once the version exists.
    await waitFor(() => expect(selectSelectedVmId(useEditorStore.getState())).toBe("vm-2"));
    expect(useEditorStore.getState().draftState["vm-1"]).toBeDefined();
  });
});

describe("EditorShell sandbox invariant", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/preview-url");
    vi.resetModules();
  });

  it("refuses to frame a preview that would share the editor's origin", async () => {
    vi.resetModules();
    vi.doMock("@/lib/preview-url", async (importOriginal) => {
      const actual = await importOriginal<typeof import("@/lib/preview-url")>();
      return { ...actual, previewIsSameOrigin: () => true };
    });
    const { EditorShell: Shell } = await import("./editor-shell");

    const project = await createProject();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<Shell projectId={project.id} />, {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    await screen.findByText("example.com/pricing");

    // `allow-scripts allow-same-origin` on a same-origin frame lets the framed
    // page unsandbox itself, so there is no iframe to have the attributes on.
    expect(screen.getByTestId("preview-origin-refused")).toBeInTheDocument();
    expect(screen.queryByTitle("Cloned page preview")).not.toBeInTheDocument();
  });
});

describe("EditorShell · viewing a past version", () => {
  /** A project saved once: v0 "Initial clone", and v1 as the current version. */
  async function projectWithASave(): Promise<{ project: Project; v0: Version; v1: Version }> {
    const project = await createProject();
    const applied = assignmentFor("fade-in");
    const outcome = await saveVersion(project.id, {
      parentVersionId: project.currentVersionId,
      catalogVersion: applied.catalogVersion,
      label: "Fade In on vm-1",
      diff: { set: { "vm-1": applied }, remove: [] },
    });
    if (outcome.kind !== "saved") throw new Error(`setup: the save was ${outcome.kind}`);
    const listed = listVersions(project.id);
    const v0 = listed?.versions.find((version) => version.seq === 0);
    if (!v0) throw new Error("setup: the project has no v0");
    return { project, v0, v1: outcome.version };
  }

  /** What clicking v0's row in the History tab does, via the store the tab drives. */
  function view(versionId: string) {
    act(() => {
      useEditorStore.getState().enterViewing(versionId, {});
    });
  }

  it("hides Save, Cancel and the unsaved dot, and keeps the chip on the current version", async () => {
    const { project, v0 } = await projectWithASave();
    renderShell(project.id);
    await openLoaded();

    view(v0.id);

    expect(await screen.findByText("Viewing v0 · read-only")).toBeInTheDocument();
    // docs/user_flow.md §6: "viewing vN · controls disabled · Save hidden".
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    // Help is the one action that still makes sense on a read-only screen.
    expect(screen.getByRole("link", { name: "Help" })).toBeInTheDocument();
    // The chip names what the editor would go back to, not what it is showing;
    // the banner names the version on screen.
    const context = screen.getByRole("banner").querySelector("[data-slot='top-bar-context']");
    expect(context).toHaveTextContent("v1");
  });

  it("dims the preview sheet only, and takes the clone out of the pointer's reach", async () => {
    const { project, v0 } = await projectWithASave();
    renderShell(project.id);
    await openLoaded();

    view(v0.id);

    const preview = screen.getByRole("region", { name: "Preview" });
    expect(await within(preview).findByTestId("viewing-overlay")).toBeInTheDocument();
    // Never over the Control Panel: the History tab is how another version is
    // picked and how the reader gets back.
    expect(
      within(screen.getByRole("complementary", { name: "Control Panel" })).queryByTestId(
        "viewing-overlay",
      ),
    ).not.toBeInTheDocument();
    expect(within(preview).getByTitle("Cloned page preview")).toHaveStyle({
      pointerEvents: "none",
    });
  });

  it("comes back to the current version on Escape", async () => {
    const { project, v0 } = await projectWithASave();
    renderShell(project.id);
    await openLoaded();
    view(v0.id);
    await screen.findByText("Viewing v0 · read-only");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(useEditorStore.getState().mode).toBe("editing"));
    expect(screen.queryByTestId("viewing-overlay")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("opens a version from the History tab, and Back to v1 closes it again", async () => {
    const { project } = await projectWithASave();
    renderShell(project.id);
    await openLoaded();

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /Initial clone/ }));

    expect(await screen.findByText("Viewing v0 · read-only")).toBeInTheDocument();
    expect(useEditorStore.getState().viewingVersionId).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to v1" }));

    await waitFor(() => expect(useEditorStore.getState().mode).toBe("editing"));
    // Still on History: Back is about the preview, not about the tab.
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("data-active");
  });
});
