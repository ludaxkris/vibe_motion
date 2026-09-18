import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { apiClient, type Project } from "@/lib/api-client";
import { env } from "@/lib/env";
import { initialEditorState, useEditorStore } from "@/lib/store";
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
    body: { url: "https://example.com" },
  });
  return data as Project;
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

afterEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("EditorShell", () => {
  it("shows a loading state while the project is being fetched", async () => {
    server.use(
      http.get(api("/projects/:projectId"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    renderShell("11111111-1111-1111-1111-111111111111");

    expect(await screen.findByRole("status", { name: /loading project/i })).toBeInTheDocument();
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

    const retry = await screen.findByRole("button", { name: /retry/i });
    retry.click();

    await waitFor(() => {
      expect(screen.getByText(project.title)).toBeInTheDocument();
    });
  });

  it("renders the project header, preview iframe and Control Panel when loaded", async () => {
    const project = await createProject();

    renderShell(project.id);

    expect(await screen.findByText(project.title)).toBeInTheDocument();
    expect(screen.getByText(project.sourceUrl)).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).toBeDisabled();
    expect(screen.getByText("No unsaved changes")).toBeInTheDocument();

    const preview = screen.getByRole("region", { name: "Preview" });
    const iframe = within(preview).getByTitle("Cloned page preview");
    expect(iframe).toHaveAttribute("src", `${env.apiOrigin}/projects/${project.id}/page`);
    expect(iframe).toHaveAttribute("sandbox", "allow-same-origin");

    expect(screen.getByRole("complementary", { name: "Control Panel" })).toBeInTheDocument();
  });

  it("resets the editor store when the project id changes", async () => {
    const projectA = await createProject();
    const projectB = await createProject();
    useEditorStore.setState({ selectedVmId: "vm-something" });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    const { rerender } = render(<EditorShell projectId={projectA.id} />, { wrapper: Wrapper });
    await screen.findByText(projectA.title);

    expect(useEditorStore.getState().selectedVmId).toBeNull();

    useEditorStore.setState({ selectedVmId: "vm-something-else" });
    rerender(<EditorShell projectId={projectB.id} />);
    await screen.findByText(projectB.title);

    expect(useEditorStore.getState().selectedVmId).toBeNull();
  });
});
