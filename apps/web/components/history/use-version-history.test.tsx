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
import { createProject, listVersions, restoreVersion } from "@/mocks/db";
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
  return renderHook(
    ({ id }: { id: string }) =>
      useVersionHistory(id, { currentVersionLabel: "v3", nextVersionLabel: "v4" }),
    { wrapper: Wrapper, initialProps: { id: projectId } },
  );
}

/**
 * A `/state` handler nobody gets an answer from until the test says so, one
 * gate per version — which is the only way to line up two answers in the
 * order the reader did *not* ask for.
 */
function gateVersionState(states: Record<string, EditorStateMap>) {
  const gates = new Map<string, { open: () => void; blocked: Promise<void>; ask: () => void; asked: Promise<void> }>();
  for (const versionId of Object.keys(states)) {
    let open = () => {};
    let ask = () => {};
    const blocked = new Promise<void>((resolve) => {
      open = resolve;
    });
    const asked = new Promise<void>((resolve) => {
      ask = resolve;
    });
    gates.set(versionId, { open, blocked, ask, asked });
  }
  server.use(
    http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
      const versionId = String(params.versionId);
      const gate = gates.get(versionId);
      gate?.ask();
      await gate?.blocked;
      return HttpResponse.json({ versionId, state: states[versionId] ?? {} });
    }),
  );
  return {
    asked: (versionId: string) => gates.get(versionId)?.asked ?? Promise.resolve(),
    release: (versionId: string) => gates.get(versionId)?.open(),
  };
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
  useToastStore.setState({ current: null });
});

describe("useVersionHistory · viewing", () => {
  it("puts a past version on screen read-only, leaving the current one where Save can find it", async () => {
    const { project, versions, states } = await projectWithHistory();
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);
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

  it("clears a failed view once the reader goes back to the current version", async () => {
    const { project, versions } = await projectWithHistory();
    server.use(
      http.get(
        api("/projects/:projectId/versions/:versionId/state"),
        () => HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
        { once: true },
      ),
    );
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    await act(async () => {
      await result.current.view(versions[1].id);
    });
    expect(result.current.error).toBe("Could not load that version.");

    // The current version's row is the way back, and it takes the message
    // with it — nothing is failing any more.
    await act(async () => {
      await result.current.view(versions[3].id);
    });

    expect(result.current.error).toBeNull();
  });

  it("collapses the already-viewed row on a re-click, rather than exiting and re-entering it", async () => {
    const { project, versions, states } = await projectWithHistory();
    let fetched = 0;
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
        fetched += 1;
        return HttpResponse.json({
          versionId: params.versionId,
          state: states[versions.findIndex((v) => v.id === params.versionId)] ?? {},
        });
      }),
    );
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    await act(async () => {
      await result.current.view(versions[1].id);
    });
    expect(fetched).toBe(1);

    // Clicking the same (already open) row again: the row's own click-to-
    // collapse, not a fresh view of the same version.
    await act(async () => {
      await result.current.view(versions[1].id);
    });

    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.viewingVersionId).toBeNull();
    expect(store.draftState).toEqual(states[3]);
    expect(result.current.viewing).toBe(false);
    // No second `/state` fetch: the row collapsed without re-fetching or
    // re-applying anything.
    expect(fetched).toBe(1);
  });

  it("says so and stays put when a version's state cannot be loaded", async () => {
    const { project, versions } = await projectWithHistory();
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), () =>
        HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 }),
      ),
    );
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    await act(async () => {
      await result.current.view(versions[1].id);
    });

    expect(result.current.error).toBe("Could not load that version.");
    expect(useEditorStore.getState().mode).toBe("editing");
  });
});

describe("useVersionHistory · answers that arrive too late", () => {
  it("keeps the version the reader asked for last, however the answers come back", async () => {
    const { project, versions, states } = await projectWithHistory();
    const gate = gateVersionState({
      [versions[1].id]: states[1],
      [versions[2].id]: states[2],
    });
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    // v1's row, then v2's, before either `/state` has answered.
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = result.current.view(versions[1].id);
      second = result.current.view(versions[2].id);
      await Promise.all([gate.asked(versions[1].id), gate.asked(versions[2].id)]);
    });

    // v2 lands first, then v1's stale answer.
    await act(async () => {
      gate.release(versions[2].id);
      await second;
      gate.release(versions[1].id);
      await first;
    });

    const store = useEditorStore.getState();
    expect(store.viewingVersionId).toBe(versions[2].id);
    expect(store.draftState).toEqual(states[2]);
    expect(result.current.viewingLabel).toBe("v2");
  });

  it("never enters viewing after the reader has left the History tab", async () => {
    const { project, versions, states } = await projectWithHistory();
    const gate = gateVersionState({ [versions[1].id]: states[1] });
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.view(versions[1].id);
      await gate.asked(versions[1].id);
    });
    // Leaving the tab: `back()` has nothing to leave yet — viewing has not
    // started — but it must still cancel what is on its way.
    act(() => {
      result.current.back();
    });

    await act(async () => {
      gate.release(versions[1].id);
      await pending;
    });

    // Behaviour 9: never viewing with the History tab closed.
    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.viewingVersionId).toBeNull();
    expect(store.draftState).toEqual(states[3]);
  });

  it("never lands one project's version in another project's editor", async () => {
    const a = await projectWithHistory();
    const b = await projectWithHistory();
    const gate = gateVersionState({ [a.versions[1].id]: a.states[1] });
    const { result, rerender } = renderHistory(a.project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.view(a.versions[1].id);
      await gate.asked(a.versions[1].id);
    });

    // What the shell does on a project change: `reset()`, same mount.
    act(() => {
      useEditorStore.getState().reset();
      useEditorStore.getState().loadVersion(b.versions[3].id, b.states[3]);
    });
    rerender({ id: b.project.id });
    await act(async () => {
      gate.release(a.versions[1].id);
      await pending;
    });

    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.currentVersionId).toBe(b.versions[3].id);
    expect(store.draftState).toEqual(b.states[3]);
  });

  it("keeps quiet about a failure the reader has already moved on from", async () => {
    const { project, versions } = await projectWithHistory();
    let release = () => {};
    let ask = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = new Promise<void>((resolve) => {
      ask = resolve;
    });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async () => {
        ask();
        await blocked;
        return HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 });
      }),
    );
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.view(versions[1].id);
      await asked;
    });
    act(() => {
      result.current.back();
    });
    await act(async () => {
      release();
      await pending;
    });

    // The request the message would be about is one nobody is waiting for.
    expect(result.current.error).toBeNull();
  });

  it("refuses to view a past version while a restore is in flight", async () => {
    const { project, versions, states } = await projectWithHistory();
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    let release = () => {};
    let ask = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = new Promise<void>((resolve) => {
      ask = resolve;
    });
    server.use(
      http.post(api("/projects/:projectId/versions/:versionId/restore"), async ({ params }) => {
        ask();
        await blocked;
        const written = restoreVersion(String(params.projectId), String(params.versionId));
        return HttpResponse.json(written.body, { status: written.status });
      }),
    );

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.restore(versions[1].id);
      await asked;
    });

    // A restore ends viewing by landing on the version it creates, so a view
    // started now is either thrown away or lands *after* it and puts a past
    // version back on screen as the current one. The row's button is disabled
    // for the same reason, so the click never gets this far in the app.
    await act(async () => {
      await result.current.view(versions[0].id);
    });
    expect(useEditorStore.getState().mode).toBe("editing");
    expect(useEditorStore.getState().viewingVersionId).toBeNull();

    await act(async () => {
      release();
      await pending;
    });

    const store = useEditorStore.getState();
    expect(store.mode).toBe("editing");
    expect(store.draftState).toEqual(states[1]);
    expect(result.current.error).toBeNull();
  });

  it("keeps a restore that outlives the tab, and says nothing into the void", async () => {
    const { project, versions } = await projectWithHistory();
    const { result, unmount } = renderHistory(project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    let release = () => {};
    let ask = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = new Promise<void>((resolve) => {
      ask = resolve;
    });
    server.use(
      http.post(api("/projects/:projectId/versions/:versionId/restore"), async ({ params }) => {
        ask();
        await blocked;
        const written = restoreVersion(String(params.projectId), String(params.versionId));
        return HttpResponse.json(written.body, { status: written.status });
      }),
    );

    const restore = result.current.restore;
    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = restore(versions[1].id);
      await asked;
    });
    unmount();
    await act(async () => {
      release();
      await pending;
    });

    // The version was written, so the store must follow it — but a toast for a
    // screen that is gone belongs to nobody.
    expect(listVersions(project.id)?.versions).toHaveLength(5);
    expect(useEditorStore.getState().currentVersionId).not.toBe(versions[3].id);
    expect(useToastStore.getState().current).toBeNull();
  });
});

describe("useVersionHistory · restore", () => {
  it("restores a past version as a new one, and lands the editor on it", async () => {
    const { project, versions, states } = await projectWithHistory();
    const { result } = renderHistory(project.id);
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

  it("never lands a restore's state in a project the reader has since left", async () => {
    // Same hazard `view()` already guards against (see "never lands one
    // project's version in another project's editor" above): the restore's
    // own `/state` fetch answers after the reader has moved to another
    // project, and must not write into that project's editor — nor leave it
    // pinned to a version id that blocks its own open load for ever
    // (`useProjectVersions`' `needsCurrentVersion` checks `currentVersionId
    // !== null`).
    const a = await projectWithHistory();
    const b = await projectWithHistory();
    let release = () => {};
    let ask = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const asked = new Promise<void>((resolve) => {
      ask = resolve;
    });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
        // Only the restore's own fetch (for the version it just created) is
        // gated; nothing else in this test asks for a's state.
        if (String(params.projectId) !== a.project.id) {
          return HttpResponse.json({ versionId: params.versionId, state: {} });
        }
        ask();
        await blocked;
        return HttpResponse.json({
          versionId: params.versionId,
          state: a.states[1],
        });
      }),
    );
    const { result, rerender } = renderHistory(a.project.id);
    await waitFor(() => expect(result.current.versions).toHaveLength(4));

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.restore(a.versions[1].id);
      await asked;
    });

    // What the shell does on a project change: `reset()`, same mount.
    act(() => {
      useEditorStore.getState().reset();
      useEditorStore.getState().loadVersion(b.versions[3].id, b.states[3]);
    });
    rerender({ id: b.project.id });
    await act(async () => {
      release();
      await pending;
    });

    // The version really was created on the server (the restore click was
    // real and stands), but the editor — now on b — must be untouched by it.
    const store = useEditorStore.getState();
    expect(store.currentVersionId).toBe(b.versions[3].id);
    expect(store.draftState).toEqual(b.states[3]);
    expect(useToastStore.getState().current).toBeNull();
  });

  it("keeps the version on screen and says why when the restore fails", async () => {
    const { project, versions } = await projectWithHistory();
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);
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
    const { result } = renderHistory(project.id);

    expect(result.current.pending).toBe(true);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.versions.map((version) => version.seq)).toEqual([0, 1, 2, 3]);
    expect(result.current.currentVersionId).toBe(versions[3].id);
    expect(result.current.currentLabel).toBe("v3");
    expect(result.current.nextLabel).toBe("v4");
    expect(result.current.listError).toBe(false);
  });

  it("names the store's current version even while the list still says the old one", async () => {
    // The rule the Export tab's "Save first" rests on: a save moves the
    // store's `currentVersionId` immediately (`markSaved`), and the list is
    // merely invalidated — so a hook that read the list first would hand the
    // Export tab the version the reader saved *away from*, and the panel would
    // export v3 the moment after v4 was written. `storeVersionId ??
    // listVersionId`, in that order, is what makes it v4.
    //
    // (The other half — the 201's version being in the cached list before
    // `mutateAsync` resolves — is `lib/versions/queries.test.tsx`, "puts the
    // version it wrote in the list, without waiting for the refetch".)
    const { project, versions } = await projectWithHistory();
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(result.current.currentVersionId).toBe(versions[3].id);

    // A save, as the store sees it, with the list left exactly as it was.
    act(() => {
      useEditorStore.getState().markSaved({ ...versions[3], id: "saved-just-now", seq: 4 });
    });

    expect(result.current.currentVersionId).toBe("saved-just-now");
    // …and the list is still the stale one, which is the point of the test.
    expect(result.current.versions.map((version) => version.id)).not.toContain("saved-just-now");
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
    const { result } = renderHistory(project.id);
    await waitFor(() => expect(result.current.listError).toBe(true));

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.versions).toHaveLength(4));
    expect(result.current.listError).toBe(false);
  });
});
