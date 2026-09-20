import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { env } from "@/lib/env";
import { createProject, listVersions } from "@/mocks/db";
import { server } from "@/mocks/server";
import { useRestoreVersion, useSaveVersion, useVersions, versionStateKey } from "./queries";

const api = (path: string) => `${env.apiOrigin}${path}`;

/**
 * The list answers once and never usefully again, so the refetch a write
 * triggers cannot be what supplies the new version: whatever the list holds
 * afterwards is what the write itself put there. (Hanging the refetch instead
 * would hang the write — `onSuccess` awaits the invalidation.)
 */
function listAnswersOnce() {
  let answered = 0;
  server.use(
    http.get(api("/projects/:projectId/versions"), ({ params }) => {
      answered += 1;
      if (answered > 1) {
        return HttpResponse.json({ code: "internal_error", message: "boom" }, { status: 500 });
      }
      return HttpResponse.json(listVersions(String(params.projectId)));
    }),
  );
}

function wrapper(client: QueryClient) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("useSaveVersion", () => {
  it("refreshes the versions list after a save", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    const client = newClient();
    const { result } = renderHook(() => ({ list: useVersions(p.id), save: useSaveVersion(p.id) }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    await act(async () => {
      await result.current.save.mutateAsync({
        parentVersionId: p.currentVersionId, catalogVersion: "1.1.0",
        diff: { set: { "vm-1": { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: {} } }, remove: [] },
      });
    });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(2));
  });

  it("puts the version it wrote in the list, without waiting for the refetch", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    listAnswersOnce();
    const client = newClient();
    const { result } = renderHook(() => ({ list: useVersions(p.id), save: useSaveVersion(p.id) }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    let outcome: Awaited<ReturnType<typeof result.current.save.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.save.mutateAsync({
        parentVersionId: p.currentVersionId, catalogVersion: "1.1.0",
        diff: { set: { "vm-1": { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: {} } }, remove: [] },
      });
    });

    // The 201 *is* the version, so this is the list a beat early rather than a
    // guess. Everything derived from the list — the version chip, "Save as
    // v<n>" — otherwise names the version before this one until the refetch
    // answers, and a second quick save would offer a label that already exists.
    if (outcome?.kind !== "saved") throw new Error(`the save was ${outcome?.kind}`);
    await waitFor(() =>
      expect(result.current.list.data?.versions.map((version) => version.seq)).toEqual([0, 1]),
    );
    expect(result.current.list.data?.currentVersionId).toBe(outcome.version.id);
  });

  it("does not invalidate cached version state, only the versions list itself", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    const client = newClient();
    const stateKey = versionStateKey(p.id, p.currentVersionId);
    client.setQueryData(stateKey, { "vm-0": null });

    const { result } = renderHook(() => ({ list: useVersions(p.id), save: useSaveVersion(p.id) }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    await act(async () => {
      await result.current.save.mutateAsync({
        parentVersionId: p.currentVersionId, catalogVersion: "1.1.0",
        diff: { set: { "vm-1": { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: {} } }, remove: [] },
      });
    });

    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(2));
    expect(client.getQueryState(stateKey)?.isInvalidated).toBe(false);
  });
});

describe("useRestoreVersion", () => {
  it("refreshes the versions list after a restore", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    const client = newClient();
    const { result } = renderHook(
      () => ({ list: useVersions(p.id), restore: useRestoreVersion(p.id) }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    await act(async () => {
      await result.current.restore.mutateAsync({ versionId: p.currentVersionId });
    });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(2));
  });

  it("puts the version it restored into in the list, without waiting for the refetch", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    listAnswersOnce();
    const client = newClient();
    const { result } = renderHook(
      () => ({ list: useVersions(p.id), restore: useRestoreVersion(p.id) }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    let outcome: Awaited<ReturnType<typeof result.current.restore.mutateAsync>> | undefined;
    await act(async () => {
      outcome = await result.current.restore.mutateAsync({ versionId: p.currentVersionId });
    });

    // Restore is the other thing that may write a version (CLAUDE.md rule 9),
    // so it owes the list the same answer.
    if (outcome?.kind !== "saved") throw new Error(`the restore was ${outcome?.kind}`);
    await waitFor(() =>
      expect(result.current.list.data?.versions.map((version) => version.seq)).toEqual([0, 1]),
    );
    expect(result.current.list.data?.currentVersionId).toBe(outcome.version.id);
  });

  it("also invalidates the list on a stale outcome (second save with the old parent)", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    const client = newClient();
    const { result } = renderHook(() => ({ list: useVersions(p.id), save: useSaveVersion(p.id) }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    const body = {
      parentVersionId: p.currentVersionId, catalogVersion: "1.1.0",
      diff: { set: { "vm-1": { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load" as const, params: {} } }, remove: [] as string[] },
    };
    await act(async () => {
      await result.current.save.mutateAsync(body);
    });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(2));

    const invalidateSpy = vi.spyOn(client, "invalidateQueries");
    let staleOutcome: Awaited<ReturnType<typeof result.current.save.mutateAsync>> | undefined;
    await act(async () => {
      staleOutcome = await result.current.save.mutateAsync(body);
    });
    expect(staleOutcome?.kind).toBe("stale");
    expect(invalidateSpy).toHaveBeenCalled();
  });
});
