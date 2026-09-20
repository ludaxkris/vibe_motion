import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, delay, http } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Assignment, Project, Version } from "@/lib/api-client";
import { defaultAssignmentFor, getCatalogEntry } from "@/lib/catalog";
import { env } from "@/lib/env";
import { initialEditorState, selectUnsaved, useEditorStore } from "@/lib/store";
import { versionStateKey } from "@/lib/versions/queries";
import { createProject, createVersion } from "@/mocks/db";
import { server } from "@/mocks/server";

import { useProjectVersions } from "./use-project-versions";

const api = (path: string) => `${env.apiOrigin}${path}`;

/** A query client the test can inspect, and the provider around it. */
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, Wrapper };
}

function assignment(animationId: string): Assignment {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`no catalog entry ${animationId}`);
  return defaultAssignmentFor(entry);
}

/** A project whose current version is `v1`, animating `vm-1`. */
function projectWithOneSave(): { project: Project; v1: Version; saved: Assignment } {
  const created = createProject("https://example.com/pricing");
  if (created.status !== 201) throw new Error("setup: could not create the project");
  const saved = assignment("fade-in");
  const result = createVersion(created.body.id, {
    parentVersionId: created.body.currentVersionId,
    catalogVersion: saved.catalogVersion,
    label: "Fade In on vm-1",
    diff: { set: { "vm-1": saved }, remove: [] },
  });
  if (result.status !== 201) throw new Error("setup: could not create the version");
  return { project: { ...created.body, currentVersionId: result.body.id }, v1: result.body, saved };
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("useProjectVersions", () => {
  it("loads the current version's state into the store when the project opens", async () => {
    const { project, v1, saved } = projectWithOneSave();
    const { Wrapper } = harness();

    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(v1.id));
    const state = useEditorStore.getState();
    // Both halves: the draft is what the iframe shows, `currentVersionState`
    // is what Save diffs against — and the two start out equal, so the editor
    // opens clean rather than unsaved.
    expect(state.draftState).toEqual({ "vm-1": saved });
    expect(state.currentVersionState).toEqual({ "vm-1": saved });
    expect(selectUnsaved(state)).toBe(false);

    expect(result.current.versions.map((version) => version.seq)).toEqual([0, 1]);
    expect(result.current.currentVersion?.id).toBe(v1.id);
    expect(result.current.currentVersionLabel).toBe("v1");
    expect(result.current.nextVersionLabel).toBe("v2");
  });

  it("waits for the project before asking for its versions", async () => {
    const { project } = projectWithOneSave();
    const { Wrapper } = harness();
    let listed = 0;
    server.use(
      http.get(api("/projects/:projectId/versions"), () => {
        listed += 1;
        return HttpResponse.json({ currentVersionId: "x", versions: [] });
      }),
    );

    // What the shell passes while its own project query is still pending.
    const { result } = renderHook(() => useProjectVersions(project.id, undefined), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.versions).toEqual([]));
    expect(listed).toBe(0);
    expect(useEditorStore.getState().currentVersionId).toBeNull();
  });

  it("loads once per project open, however many times the screen mounts", async () => {
    const { project, v1 } = projectWithOneSave();
    const { Wrapper } = harness();
    let fetched = 0;
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), () => {
        fetched += 1;
        return HttpResponse.json({ versionId: v1.id, state: {} });
      }),
    );

    const first = renderHook(() => useProjectVersions(project.id, project), { wrapper: Wrapper });
    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(v1.id));
    expect(fetched).toBe(1);

    // A fresh mount over a store that has already been loaded: the version the
    // draft was forked from is what says the open load is done, not a ref that
    // the remount threw away.
    const mine = assignment("pulse");
    act(() => {
      useEditorStore.getState().setDraftAssignment("vm-9", mine);
    });
    first.unmount();
    renderHook(() => useProjectVersions(project.id, project), { wrapper: Wrapper });

    await waitFor(() => expect(fetched).toBe(1));
    expect(useEditorStore.getState().draftState["vm-9"]).toEqual(mine);
  });

  it("never loads over unsaved work, even when the edit lands mid-fetch", async () => {
    const { project, v1, saved } = projectWithOneSave();
    const { client, Wrapper } = harness();
    let release = () => {};
    let asked = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      asked = resolve;
    });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async () => {
        asked();
        await gate;
        return HttpResponse.json({ versionId: v1.id, state: { "vm-1": saved } });
      }),
    );

    renderHook(() => useProjectVersions(project.id, project), { wrapper: Wrapper });
    // The load has passed every check it makes up front and is waiting on the
    // network — which is the only window this guard is about.
    await act(async () => {
      await inFlight;
    });

    // The draft is dirty by the time `stateAt()` answers. Loading now would
    // replace `draftState` wholesale and take the edit with it.
    const mine = assignment("pulse");
    act(() => {
      useEditorStore.getState().setDraftAssignment("vm-9", mine);
    });
    await act(async () => {
      release();
      await gate;
    });

    // The fetch did land — the cache proves it — and the store was left alone.
    await waitFor(() =>
      expect(client.getQueryData(versionStateKey(project.id, v1.id))).toEqual({
        "vm-1": saved,
      }),
    );
    expect(useEditorStore.getState().draftState).toEqual({ "vm-9": mine });
    expect(useEditorStore.getState().currentVersionId).toBeNull();
  });

  it("follows the store's current version, which moves on save before any refetch lands", async () => {
    const { project, v1 } = projectWithOneSave();
    const { Wrapper } = harness();
    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.currentVersionLabel).toBe("v1"));

    // `markSaved` moves `currentVersionId` the instant the 201 lands; the list
    // is only invalidated, so for a beat it still names the older version.
    const v0 = result.current.versions[0];
    act(() => {
      useEditorStore.setState({ currentVersionId: v0.id });
    });

    expect(v0.id).not.toBe(v1.id);
    expect(result.current.currentVersion?.id).toBe(v0.id);
    expect(result.current.currentVersionLabel).toBe("v0");
    // Unrelated to the store: the next version is the list's own high-water mark.
    expect(result.current.nextVersionLabel).toBe("v2");
  });

  it("names the list's current version while its state is still in flight", async () => {
    const { project, v1 } = projectWithOneSave();
    const { Wrapper } = harness();
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });

    // The chip must not wait on `stateAt()`: the list already says which
    // version is current.
    await waitFor(() => expect(result.current.currentVersionLabel).toBe("v1"));
    expect(result.current.currentVersion?.id).toBe(v1.id);
    expect(useEditorStore.getState().currentVersionId).toBeNull();
  });

  it("has no label to offer before the list lands, and still names the first save", async () => {
    const { project } = projectWithOneSave();
    const { Wrapper } = harness();
    server.use(
      http.get(api("/projects/:projectId/versions"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });

    expect(result.current.currentVersionLabel).toBeUndefined();
    // v1 is the lowest a save can ever create: v0 is the clone itself.
    expect(result.current.nextVersionLabel).toBe("v1");
  });
});
