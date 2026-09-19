import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PROTOCOL_VERSION } from "bridge";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient, type Assignment, type Project } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import { env } from "@/lib/env";
import { previewOrigin } from "@/lib/preview-url";
import { readRecentProjects, rememberRecentProject } from "@/lib/recent-projects";
import { initialEditorState, selectSelectedVmId, useEditorStore } from "@/lib/store";
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
