import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createProject } from "@/mocks/db";
import { useRestoreVersion, useSaveVersion, useVersions, versionStateKey } from "./queries";

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

  it("also invalidates the list on a stale outcome (second save with the old parent)", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    const client = newClient();
    const { result } = renderHook(() => ({ list: useVersions(p.id), save: useSaveVersion(p.id) }), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    const body = {
      parentVersionId: p.currentVersionId, catalogVersion: "1.1.0",
      diff: { set: { "vm-1": { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: {} } }, remove: [] },
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
