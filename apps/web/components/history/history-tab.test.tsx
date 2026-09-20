import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Assignment, Project, Version } from "@/lib/api-client";
import { defaultAssignmentFor, getCatalogEntry } from "@/lib/catalog";
import { env } from "@/lib/env";
import { initialEditorState, useEditorStore } from "@/lib/store";
import { saveVersion } from "@/lib/versions/api";
import { createProject, listVersions } from "@/mocks/db";
import { server } from "@/mocks/server";

import { HistoryTab } from "./history-tab";
import { useVersionHistory, type VersionHistory } from "./use-version-history";

const api = (path: string) => `${env.apiOrigin}${path}`;

function assignment(animationId: string): Assignment {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`no catalog entry ${animationId}`);
  return defaultAssignmentFor(entry);
}

/** A project with v0 (the clone), v1 "Fade In on vm-1" and v2 "Pulse on vm-2". */
async function projectWithHistory(): Promise<{ project: Project; versions: Version[] }> {
  const created = createProject("https://example.com/pricing");
  if (created.status !== 201) throw new Error("setup: could not create the project");
  const project = created.body;

  const state: Record<string, Assignment> = {};
  let parentVersionId = project.currentVersionId;
  for (const [vmId, animationId, label] of [
    ["vm-1", "fade-in", "Fade In on vm-1"],
    ["vm-2", "pulse", "Pulse on vm-2"],
  ] as const) {
    const applied = assignment(animationId);
    state[vmId] = applied;
    const outcome = await saveVersion(project.id, {
      parentVersionId,
      catalogVersion: applied.catalogVersion,
      label,
      diff: { set: { [vmId]: applied }, remove: [] },
    });
    if (outcome.kind !== "saved") throw new Error(`setup: the save was ${outcome.kind}`);
    parentVersionId = outcome.version.id;
  }

  const listed = listVersions(project.id);
  if (!listed) throw new Error("setup: the project has no versions");
  useEditorStore.getState().loadVersion(parentVersionId, { ...state });

  return { project, versions: [...listed.versions].sort((a, b) => a.seq - b.seq) };
}

/**
 * The tab as the Control Panel mounts it: the shell owns the hook, so the
 * harness stands in for the shell.
 */
let history: VersionHistory | null = null;

function Harness({ projectId }: { projectId: string }) {
  const value = useVersionHistory(projectId, {
    currentVersionLabel: "v2",
    nextVersionLabel: "v3",
  });
  // Published from an effect, not during render: the hook's own result is
  // what the tab renders, and a render must not write to the outside world.
  useEffect(() => {
    history = value;
  }, [value]);
  return <HistoryTab history={value} />;
}

function renderTab(projectId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<Harness projectId={projectId} />, { wrapper: Wrapper });
}

beforeEach(() => {
  history = null;
  useEditorStore.setState({ ...initialEditorState });
});

describe("HistoryTab", () => {
  it("shows a status spinner while the list is in flight", async () => {
    const { project } = await projectWithHistory();
    server.use(
      http.get(api("/projects/:projectId/versions"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    renderTab(project.id);

    expect(await screen.findByRole("status", { name: "Loading history" })).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("says the list could not be loaded, and loads it on Retry", async () => {
    const { project } = await projectWithHistory();
    server.use(
      http.get(
        api("/projects/:projectId/versions"),
        () => HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
        { once: true },
      ),
    );
    renderTab(project.id);
    expect(await screen.findByText("Could not load version history.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Pulse on vm-2")).toBeInTheDocument();
    expect(screen.queryByText("Could not load version history.")).not.toBeInTheDocument();
  });

  it("lists every version newest first, with the current one marked", async () => {
    const { project } = await projectWithHistory();
    renderTab(project.id);
    await screen.findByText("Pulse on vm-2");

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent?.slice(0, 2))).toEqual(["v2", "v1", "v0"]);
    expect(within(rows[0]).getByText("Current")).toBeInTheDocument();
  });

  it("puts the clicked version on screen read-only, and expands its row", async () => {
    const { project, versions } = await projectWithHistory();
    renderTab(project.id);
    await screen.findByText("Pulse on vm-2");

    fireEvent.click(screen.getByRole("button", { name: /Fade In on vm-1/ }));

    await waitFor(() => expect(useEditorStore.getState().mode).toBe("viewing"));
    expect(useEditorStore.getState().viewingVersionId).toBe(versions[1].id);
    const row = screen.getByRole("button", { name: /Fade In on vm-1/ });
    expect(row).toHaveAttribute("aria-expanded", "true");
    // The expanded row is where Restore lives, next to Phase 7's Export.
    expect(screen.getByRole("button", { name: "Restore" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Export v1/ })).toBeDisabled();
  });

  it("keeps the rows when a refresh fails on top of a list it already has", async () => {
    const { project } = await projectWithHistory();
    renderTab(project.id);
    await screen.findByText("Pulse on vm-2");
    server.use(
      http.get(api("/projects/:projectId/versions"), () =>
        HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
      ),
    );

    // What a restore's list invalidation does — and what must not throw away
    // three rows that are still perfectly true.
    await act(async () => {
      history?.retry();
    });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not load version history.",
    ));
    expect(screen.getByText("Pulse on vm-2")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // The one action that can fix it is still offered, next to the rows.
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("surfaces a version that could not be loaded without leaving the list", async () => {
    const { project } = await projectWithHistory();
    renderTab(project.id);
    await screen.findByText("Pulse on vm-2");
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), () =>
        HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: /Fade In on vm-1/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load that version.");
    expect(useEditorStore.getState().mode).toBe("editing");
    expect(screen.getByText("Fade In on vm-1")).toBeInTheDocument();
  });
});
