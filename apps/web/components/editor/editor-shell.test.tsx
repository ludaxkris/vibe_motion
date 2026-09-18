import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient, type Assignment, type Project } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";
import { env } from "@/lib/env";
import { readRecentProjects } from "@/lib/recent-projects";
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
    expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");

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
