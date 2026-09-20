import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useToastStore } from "@/components/ui/toast";
import type { Assignment, EditorStateMap, Project, Version } from "@/lib/api-client";
import { defaultAssignmentFor, getCatalogEntry } from "@/lib/catalog";
import { env } from "@/lib/env";
import { initialEditorState, selectUnsaved, useEditorStore } from "@/lib/store";
import { saveVersion } from "@/lib/versions/api";
import { createProject, listVersions } from "@/mocks/db";
import { server } from "@/mocks/server";

import { useVersionHistory } from "./use-version-history";

const api = (path: string) => `${env.apiOrigin}${path}`;

function assignment(animationId: string): Assignment {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`no catalog entry ${animationId}`);
  return defaultAssignmentFor(entry);
}

/**
 * A project saved three times over its clone: v0 (nothing) · v1 (`vm-1`) ·
 * v2 (+`vm-2`) · v3 (+`vm-3`), with the store opened on v3 the way
 * `useProjectVersions` leaves it.
 *
 * Built through `saveVersion`, so every version's state is one the API itself
 * materialised from diffs rather than one the test wrote by hand.
 */
async function projectWithHistory(): Promise<{
  project: Project;
  /** Ascending by `seq`: v0 … v3. */
  versions: Version[];
  /** The full state at each `seq`. */
  states: EditorStateMap[];
}> {
  const created = createProject("https://example.com/pricing");
  if (created.status !== 201) throw new Error("setup: could not create the project");
  const project = created.body;

  const cumulative: EditorStateMap = {};
  const states: EditorStateMap[] = [{}];
  let parentVersionId = project.currentVersionId;
  for (const [vmId, animationId] of [
    ["vm-1", "fade-in"],
    ["vm-2", "pulse"],
    ["vm-3", "shake"],
  ] as const) {
    const applied = assignment(animationId);
    cumulative[vmId] = applied;
    const outcome = await saveVersion(project.id, {
      parentVersionId,
      catalogVersion: applied.catalogVersion,
      label: `${animationId} on ${vmId}`,
      diff: { set: { [vmId]: applied }, remove: [] },
    });
    if (outcome.kind !== "saved") throw new Error(`setup: the save was ${outcome.kind}`);
    parentVersionId = outcome.version.id;
    states.push({ ...cumulative });
  }

  const listed = listVersions(project.id);
  if (!listed) throw new Error("setup: the project has no versions");
  useEditorStore.getState().loadVersion(parentVersionId, states[states.length - 1]);

  return {
    project,
    versions: [...listed.versions].sort((a, b) => a.seq - b.seq),
    states,
  };
}

function renderHistory(projectId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  const { result } = renderHook(
    () => useVersionHistory(projectId, { currentVersionLabel: "v3", nextVersionLabel: "v4" }),
    { wrapper: Wrapper },
  );
  return result;
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
  useToastStore.setState({ current: null });
});

describe("useVersionHistory · viewing", () => {
  it("puts a past version on screen read-only, leaving the current one where Save can find it", async () => {
    const { project, versions, states } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    await act(async () => {
      await result.current.view(versions[1].id);
    });

    const store = useEditorStore.getState();
    expect(store.mode).toBe("viewing");
    expect(store.viewingVersionId).toBe(versions[1].id);
    // The iframe renders `draftState`, so viewing *is* the draft holding v1 —
    // while `currentVersionState` still holds v3, which is what Back returns
    // to without a fetch and what the next Save diffs against.
    expect(store.draftState).toEqual(states[1]);
    expect(store.currentVersionState).toEqual(states[3]);
    expect(store.currentVersionId).toBe(versions[3].id);
    // Viewing is never "unsaved": the guard must not fire on the way out.
    expect(selectUnsaved(store)).toBe(false);
    expect(result.current.viewingLabel).toBe("v1");
    expect(result.current.viewing).toBe(true);
  });

  it("moves from one past version to another without going back first", async () => {
    const { project, versions, states } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    await act(async () => {
      await result.current.view(versions[1].id);
    });
    await act(async () => {
      await result.current.view(versions[2].id);
    });

    const store = useEditorStore.getState();
    expect(store.viewingVersionId).toBe(versions[2].id);
    expect(store.draftState).toEqual(states[2]);
    expect(store.currentVersionState).toEqual(states[3]);
    expect(result.current.viewingLabel).toBe("v2");
  });

  it("treats the current version's own row as the way back", async () => {
    const { project, versions, states } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    await act(async () => {
      await result.current.view(versions[1].id);
    });

    await act(async () => {
      await result.current.view(versions[3].id);
    });

    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.viewingVersionId).toBeNull();
    expect(store.draftState).toEqual(states[3]);
    expect(result.current.viewing).toBe(false);
  });

  it("goes back to the current version", async () => {
    const { project, versions, states } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    await act(async () => {
      await result.current.view(versions[0].id);
    });

    act(() => {
      result.current.back();
    });

    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.draftState).toEqual(states[3]);
  });

  it("refuses to view over an unsaved draft, rather than throwing the draft away", async () => {
    const { project, versions } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    const mine = assignment("spin");
    act(() => {
      useEditorStore.getState().setDraftAssignment("vm-9", mine);
    });

    await act(async () => {
      await result.current.view(versions[1].id);
    });

    // The tab guard is what should have stopped this; `enterViewing` throws on
    // a dirty draft, so the hook must not reach it.
    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.draftState["vm-9"]).toEqual(mine);
  });

  it("says so and stays put when a version's state cannot be loaded", async () => {
    const { project, versions } = await projectWithHistory();
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), () =>
        HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
      ),
    );
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    await act(async () => {
      await result.current.view(versions[1].id);
    });

    expect(result.current.error).toBe("Could not load that version.");
    expect(useEditorStore.getState().mode).toBe("editing");
  });
});

describe("useVersionHistory · restore", () => {
  it("restores a past version as a new one, and lands the editor on it", async () => {
    const { project, versions, states } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    await act(async () => {
      await result.current.view(versions[1].id);
    });

    await act(async () => {
      await result.current.restore(versions[1].id);
    });

    // Restoring appends: v0…v3 stay in the list and v4 reproduces v1.
    await waitFor(() => expect(result.current.versions).toHaveLength(5));
    const created = result.current.versions.at(-1) as Version;
    expect(created.seq).toBe(4);

    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.currentVersionId).toBe(created.id);
    expect(store.draftState).toEqual(states[1]);
    expect(store.currentVersionState).toEqual(states[1]);
    expect(selectUnsaved(store)).toBe(false);
    expect(useToastStore.getState().current?.message).toBe("Restored v1 as v4");
    expect(result.current.restoring).toBe(false);
  });

  it("keeps the version on screen and says why when the restore fails", async () => {
    const { project, versions } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    await act(async () => {
      await result.current.view(versions[1].id);
    });
    server.use(
      http.post(api("/projects/:projectId/versions/:versionId/restore"), () =>
        HttpResponse.json({ code: "internal_error", message: "Unhandled failure" }, { status: 500 }),
      ),
    );

    await act(async () => {
      await result.current.restore(versions[1].id);
    });

    expect(result.current.error).toBe("Unhandled failure");
    expect(result.current.restoring).toBe(false);
    // Nothing was written, so the version the user asked about is still on screen.
    expect(useEditorStore.getState().mode).toBe("viewing");
    expect(useEditorStore.getState().viewingVersionId).toBe(versions[1].id);
    expect(listVersions(project.id)?.versions).toHaveLength(4);
  });

  it("retries a busy project once, and restores", async () => {
    const { project, versions } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    server.use(
      http.post(
        api("/projects/:projectId/versions/:versionId/restore"),
        () => new HttpResponse(null, { status: 503, headers: { "Retry-After": "0" } }),
        { once: true },
      ),
    );

    await act(async () => {
      await result.current.restore(versions[1].id);
    });

    expect(result.current.error).toBeNull();
    expect(listVersions(project.id)?.versions).toHaveLength(5);
  });

  it("writes one version however fast Restore is clicked twice", async () => {
    const { project, versions } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    // Both clicks land before React has re-rendered the disabled button, so
    // the in-flight guard cannot be a piece of state either of them reads.
    await act(async () => {
      await Promise.all([
        result.current.restore(versions[1].id),
        result.current.restore(versions[1].id),
      ]);
    });

    expect(listVersions(project.id)?.versions).toHaveLength(5);
  });

  it("stops after that one retry rather than hammering a busy project", async () => {
    const { project, versions } = await projectWithHistory();
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    let attempts = 0;
    server.use(
      http.post(api("/projects/:projectId/versions/:versionId/restore"), () => {
        attempts += 1;
        return new HttpResponse(null, { status: 503, headers: { "Retry-After": "0" } });
      }),
    );

    await act(async () => {
      await result.current.restore(versions[1].id);
    });

    expect(attempts).toBe(2);
    expect(result.current.error).toBe("The project is busy. Try again in a moment.");
    expect(result.current.restoring).toBe(false);
  });
});

describe("useVersionHistory · the list", () => {
  it("offers the list, the labels and a retry once the versions land", async () => {
    const { project, versions } = await projectWithHistory();
    const result = renderHistory(project.id);

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.versions.map((version) => version.seq)).toEqual([0, 1, 2, 3]);
    expect(result.current.currentVersionId).toBe(versions[3].id);
    expect(result.current.currentLabel).toBe("v3");
    expect(result.current.nextLabel).toBe("v4");
    expect(result.current.listError).toBe(false);
  });

  it("reports a list that could not be loaded, and loads it on retry", async () => {
    const { project } = await projectWithHistory();
    server.use(
      http.get(
        api("/projects/:projectId/versions"),
        () => HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
        { once: true },
      ),
    );
    const result = renderHistory(project.id);
    await waitFor(() => expect(result.current.listError).toBe(true));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    expect(result.current.listError).toBe(false);
  });
});
