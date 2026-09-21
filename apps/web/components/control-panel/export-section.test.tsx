import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { VersionHistory } from "@/components/history/use-version-history";
import type { Assignment, EditorStateMap, ExportBundle, Version } from "@/lib/api-client";
import { env } from "@/lib/env";
import { initialEditorState, useEditorStore } from "@/lib/store";
import { server } from "@/mocks/server";

import { ExportSection } from "./export-section";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const V5 = "55555555-5555-4555-8555-555555555555";
const V3 = "33333333-3333-4333-8333-333333333333";

const api = (path: string) => `${env.apiOrigin}${path}`;

function assignment(animationId: string, trigger: Assignment["trigger"] = "load"): Assignment {
  return { animationId, catalogVersion: "1.1.0", trigger, params: {} };
}

function version(id: string, seq: number): Version {
  return {
    id,
    projectId: PROJECT_ID,
    seq,
    label: `v${seq}`,
    parentVersionId: null,
    catalogVersion: "1.1.0",
    createdAt: "2026-09-20T10:00:00Z",
    diff: { set: {}, remove: [] },
  };
}

function historyStub(overrides: Partial<VersionHistory> = {}): VersionHistory {
  return {
    versions: [version(V3, 3), version(V5, 5)],
    pending: false,
    listError: false,
    retry: () => undefined,
    currentVersionId: V5,
    viewingVersionId: null,
    viewing: false,
    viewingLabel: undefined,
    currentLabel: "v5",
    nextLabel: "v6",
    error: null,
    restoring: false,
    view: async () => undefined,
    back: () => undefined,
    restore: async () => undefined,
    ...overrides,
  };
}

function bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    versionId: V5,
    mode: "full",
    html: "<!doctype html>",
    css: ".vm-a3 {}",
    js: null,
    files: [
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
    ],
    ...overrides,
  };
}

/** Records what the tab asked the export endpoint for. */
function mockExport(): { calls: URLSearchParams[] } {
  const calls: URLSearchParams[] = [];
  server.use(
    http.get(api("/projects/:projectId/export"), ({ request }) => {
      const query = new URL(request.url).searchParams;
      calls.push(query);
      return HttpResponse.json(bundle({ mode: (query.get("mode") as "full" | "snippet") ?? "full" }));
    }),
  );
  return { calls };
}

/** Records every `/state` request, so "read from the store" can be asserted as "no request". */
function mockVersionState(state: EditorStateMap): { calls: string[] } {
  const calls: string[] = [];
  server.use(
    http.get(api("/projects/:projectId/versions/:versionId/state"), ({ params }) => {
      calls.push(String(params.versionId));
      return HttpResponse.json({ versionId: String(params.versionId), state });
    }),
  );
  return { calls };
}

function renderSection(props: Partial<Parameters<typeof ExportSection>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(
    <ExportSection
      projectId={PROJECT_ID}
      history={historyStub()}
      exportVersionId={null}
      {...props}
    />,
    { wrapper: Wrapper },
  );
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("ExportSection", () => {
  it("exports the current version, labelled and badged as current", async () => {
    const { calls } = mockExport();
    useEditorStore.setState({ currentVersionId: V5, currentVersionState: {} });

    renderSection();

    await waitFor(() => expect(screen.getByTestId("panel-export")).toBeInTheDocument());
    expect(screen.getByText("v5")).toBeInTheDocument();
    expect(screen.getByText("· current")).toBeInTheDocument();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].get("versionId")).toBe(V5);
    expect(calls[0].get("mode")).toBe("full");
  });

  it("counts the current version off the store, without a second request", async () => {
    mockExport();
    const state = mockVersionState({});
    useEditorStore.setState({
      currentVersionId: V5,
      currentVersionState: { "vm-3": assignment("fade-in-up"), "vm-9": assignment("fade-in-up") },
    });

    renderSection();

    await waitFor(() =>
      expect(screen.getByTestId("export-stats")).toHaveTextContent("1 animation · 2 elements"),
    );
    // The store already holds the current version's state; asking the API for
    // it again would be a request for something we have.
    expect(state.calls).toEqual([]);
  });

  it("exports the pinned version, and counts it from that version's state", async () => {
    const { calls } = mockExport();
    const state = mockVersionState({ "vm-7": assignment("pulse", "hover") });
    useEditorStore.setState({
      currentVersionId: V5,
      // The current version has two elements; v3 has one. The footer must
      // describe what is being exported, not what is on screen.
      currentVersionState: { "vm-3": assignment("fade-in-up"), "vm-9": assignment("fade-in-up") },
    });

    renderSection({ exportVersionId: V3 });

    await waitFor(() => expect(calls[0]?.get("versionId")).toBe(V3));
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.queryByText("· current")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("export-stats")).toHaveTextContent("1 animation · 1 element"),
    );
    expect(state.calls).toEqual([V3]);
  });

  it("offers Snippet only when the selected element is animated in the exported version", async () => {
    mockExport();
    useEditorStore.setState({
      currentVersionId: V5,
      currentVersionState: { "vm-3": assignment("fade-in-up") },
      // Unsaved work on another element: the draft is not what gets exported.
      draftState: { "vm-3": assignment("fade-in-up"), "vm-4": assignment("pulse") },
      panel: { status: "selected", vmId: "vm-4" },
    });

    renderSection();

    await waitFor(() => expect(screen.getByTestId("panel-export")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "Snippet" })).toHaveAttribute("data-disabled");
  });

  it("offers Snippet for an element the exported version does animate", async () => {
    mockExport();
    useEditorStore.setState({
      currentVersionId: V5,
      currentVersionState: { "vm-3": assignment("fade-in-up") },
      draftState: { "vm-3": assignment("fade-in-up") },
      panel: { status: "selected", vmId: "vm-3" },
    });

    renderSection();

    await waitFor(() => expect(screen.getByTestId("panel-export")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "Snippet" })).not.toHaveAttribute("data-disabled");
  });

  it("says so rather than exporting nothing when the version list never landed", () => {
    renderSection({ history: historyStub({ versions: [], currentVersionId: null, pending: false }) });

    expect(screen.queryByTestId("panel-export")).not.toBeInTheDocument();
    expect(screen.getByText(/No saved version to export/i)).toBeInTheDocument();
  });

  it("waits quietly while the version list is still loading", () => {
    renderSection({
      history: historyStub({ versions: [], currentVersionId: null, pending: true }),
    });

    expect(screen.getByRole("status", { name: "Loading history" })).toBeInTheDocument();
  });
});
