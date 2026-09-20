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

import { useToastStore } from "@/components/ui/toast";

import { useProjectVersions, VERSION_LOAD_FAILED } from "./use-project-versions";

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
function projectWithOneSave(animationId = "fade-in"): {
  project: Project;
  v1: Version;
  saved: Assignment;
} {
  const created = createProject("https://example.com/pricing");
  if (created.status !== 201) throw new Error("setup: could not create the project");
  const saved = assignment(animationId);
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
  useToastStore.setState({ current: null });
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

  it("rebases the answer onto an edit that landed mid-fetch, rather than dead-ending", async () => {
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

    // The draft is dirty by the time `stateAt()` answers. `loadVersion` would
    // replace `draftState` wholesale and take the edit with it — and bailing
    // left a draft with no version to fork from, which Save refuses for ever.
    const mine = assignment("pulse");
    act(() => {
      useEditorStore.getState().setDraftAssignment("vm-9", mine);
    });
    await act(async () => {
      release();
      await gate;
    });

    // Lossless both ways: the draft was built on an empty base, so replaying
    // its diff onto the server's state keeps the edit and adds nothing.
    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(v1.id));
    const state = useEditorStore.getState();
    expect(state.draftState).toEqual({ "vm-1": saved, "vm-9": mine });
    expect(state.currentVersionState).toEqual({ "vm-1": saved });
    // …and the edit is still unsaved work, which is the whole point: Save now
    // has a parent version to fork from.
    expect(selectUnsaved(state)).toBe(true);
    // The fetch did land — the cache proves it.
    expect(client.getQueryData(versionStateKey(project.id, v1.id))).toEqual({ "vm-1": saved });
  });

  it("clears a failed load once a later load for the same project succeeds", async () => {
    // A fails → B (unrelated) → back to A, and this time it loads fine. Only
    // `retryLoad` used to clear `failure`, so the banner from A's first visit
    // kept re-showing even though the draft A is looking at right now is the
    // one that just loaded successfully.
    const a = projectWithOneSave("fade-in");
    const b = projectWithOneSave("pulse");
    const { Wrapper } = harness();
    server.use(
      http.get(
        api("/projects/:projectId/versions/:versionId/state"),
        ({ params }) => {
          if (String(params.projectId) === a.project.id) {
            return HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 });
          }
          return HttpResponse.json({ versionId: b.v1.id, state: { "vm-1": b.saved } });
        },
        { once: true },
      ),
    );

    const { result, rerender } = renderHook(
      ({ projectId, project }: { projectId: string; project: Project | undefined }) =>
        useProjectVersions(projectId, project),
      { wrapper: Wrapper, initialProps: { projectId: a.project.id, project: a.project as Project | undefined } },
    );
    await waitFor(() => expect(result.current.loadError).toBe(VERSION_LOAD_FAILED));

    act(() => {
      useEditorStore.getState().reset();
    });
    rerender({ projectId: b.project.id, project: b.project });
    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(b.v1.id));

    act(() => {
      useEditorStore.getState().reset();
    });
    rerender({ projectId: a.project.id, project: a.project });

    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(a.v1.id));
    expect(result.current.loadError).toBeNull();
  });

  it("loads again on a return visit, whatever the last visit to that project left behind", async () => {
    // A → B → A without a remount: the shell `reset()`s on a project change,
    // so what says "already loaded" has to be the store rather than a token
    // that still remembers A's first visit.
    const a = projectWithOneSave("fade-in");
    const b = projectWithOneSave("pulse");
    const { Wrapper } = harness();

    const { rerender } = renderHook(
      ({ projectId, project }: { projectId: string; project: Project | undefined }) =>
        useProjectVersions(projectId, project),
      {
        wrapper: Wrapper,
        initialProps: {
          projectId: a.project.id,
          project: a.project as Project | undefined,
        },
      },
    );
    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(a.v1.id));

    // Over to B, whose own project query has not answered yet — which is when
    // the shell passes `undefined` and nothing is asked for at all.
    act(() => {
      useEditorStore.getState().reset();
    });
    rerender({ projectId: b.project.id, project: undefined });
    expect(useEditorStore.getState().currentVersionId).toBeNull();

    // …and back to A, which has to fork the draft from its version again.
    act(() => {
      useEditorStore.getState().reset();
    });
    rerender({ projectId: a.project.id, project: a.project });

    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(a.v1.id));
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": a.saved });
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

  it("gives the same empty list every render, so a consumer may depend on its identity", async () => {
    const { project } = projectWithOneSave();
    const { Wrapper } = harness();
    server.use(
      http.get(api("/projects/:projectId/versions"), async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );

    const { result, rerender } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });
    const first = result.current.versions;
    rerender();

    expect(result.current.versions).toBe(first);
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

describe("useProjectVersions · a load that fails", () => {
  it("reports the failure and says so out loud, rather than opening an empty draft in silence", async () => {
    const { project } = projectWithOneSave();
    const { Wrapper } = harness();
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), () =>
        HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.loadError).toBe(VERSION_LOAD_FAILED));
    expect(useToastStore.getState().current?.message).toBe(VERSION_LOAD_FAILED);
    // The editor is showing an empty draft over a project that has animations;
    // the one thing it must not do is pretend that is the saved state.
    expect(useEditorStore.getState().currentVersionId).toBeNull();
  });

  it("loads the version and clears the error when the retry gets through", async () => {
    const { project, v1, saved } = projectWithOneSave();
    const { Wrapper } = harness();
    server.use(
      http.get(
        api("/projects/:projectId/versions/:versionId/state"),
        () => HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
        { once: true },
      ),
    );

    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.loadError).toBe(VERSION_LOAD_FAILED));

    act(() => {
      result.current.retryLoad();
    });

    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(v1.id));
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": saved });
    expect(result.current.loadError).toBeNull();
  });

  it("rebases the retry onto work the user did while the load was broken", async () => {
    const { project, v1, saved } = projectWithOneSave();
    const { Wrapper } = harness();
    server.use(
      http.get(
        api("/projects/:projectId/versions/:versionId/state"),
        () => HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
        { once: true },
      ),
    );

    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.loadError).toBe(VERSION_LOAD_FAILED));

    // The editor could only offer an empty draft, and the user carried on
    // working in it. Retry must not refuse *because* of that work — refusing
    // is what left the draft with no version to fork from and Save inert.
    const mine = assignment("pulse");
    act(() => {
      useEditorStore.getState().setDraftAssignment("vm-9", mine);
    });

    act(() => {
      result.current.retryLoad();
    });

    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(v1.id));
    const state = useEditorStore.getState();
    expect(state.draftState).toEqual({ "vm-1": saved, "vm-9": mine });
    expect(state.currentVersionState).toEqual({ "vm-1": saved });
    expect(selectUnsaved(state)).toBe(true);
    expect(result.current.loadError).toBeNull();
  });

  it("retries the list itself when that is what never landed", async () => {
    const { project, v1 } = projectWithOneSave();
    const { Wrapper } = harness();
    server.use(
      http.get(
        api("/projects/:projectId/versions"),
        () => HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
        { once: true },
      ),
    );

    const { result } = renderHook(() => useProjectVersions(project.id, project), {
      wrapper: Wrapper,
    });
    await waitFor(() => expect(result.current.versions).toEqual([]));

    act(() => {
      result.current.retryLoad();
    });

    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(v1.id));
  });

  it("never lands one project's state in another project's editor", async () => {
    // The shell `reset()`s on a project change instead of remounting, so an
    // answer for the project the user has left finds a store that looks
    // untouched — and would overwrite the project they are now on.
    const a = projectWithOneSave("fade-in");
    const b = projectWithOneSave("pulse");
    const { Wrapper } = harness();

    /** One gate per version, so each answer can be released on its own. */
    type Gate = { open: () => void; blocked: Promise<void>; ask: () => void; asked: Promise<void> };
    const gates = new Map<string, Gate>();
    for (const id of [a.v1.id, b.v1.id]) {
      const gate = {} as Gate;
      gate.blocked = new Promise<void>((resolve) => {
        gate.open = resolve;
      });
      gate.asked = new Promise<void>((resolve) => {
        gate.ask = resolve;
      });
      gates.set(id, gate);
    }
    const stateOf: Record<string, Assignment> = {
      [a.v1.id]: a.saved,
      [b.v1.id]: b.saved,
    };
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
        const versionId = String(params.versionId);
        const gate = gates.get(versionId);
        gate?.ask();
        await gate?.blocked;
        return HttpResponse.json({ versionId, state: { "vm-1": stateOf[versionId] } });
      }),
    );

    const { rerender } = renderHook(
      ({ project }: { project: Project }) => useProjectVersions(project.id, project),
      { wrapper: Wrapper, initialProps: { project: a.project } },
    );
    await act(async () => {
      await gates.get(a.v1.id)?.asked;
    });

    // What the shell does on a project change.
    act(() => {
      useEditorStore.getState().reset();
    });
    rerender({ project: b.project });
    await act(async () => {
      await gates.get(b.v1.id)?.asked;
    });

    // A's answer arrives while B's is still in flight, so the store genuinely
    // is untouched — the only thing that can refuse it is the project it
    // belongs to.
    await act(async () => {
      gates.get(a.v1.id)?.open();
      await Promise.resolve();
    });
    expect(useEditorStore.getState().currentVersionId).toBeNull();

    await act(async () => {
      gates.get(b.v1.id)?.open();
      await Promise.resolve();
    });
    await waitFor(() => expect(useEditorStore.getState().currentVersionId).toBe(b.v1.id));
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": b.saved });
  });
});
