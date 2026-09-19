import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createProject } from "@/mocks/db";
import { useSaveVersion, useVersions } from "./queries";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

describe("useSaveVersion", () => {
  it("refreshes the versions list after a save", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    const { result } = renderHook(() => ({ list: useVersions(p.id), save: useSaveVersion(p.id) }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    await act(async () => {
      await result.current.save.mutateAsync({
        parentVersionId: p.currentVersionId, catalogVersion: "1.1.0",
        diff: { set: { "vm-1": { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: {} } }, remove: [] },
      });
    });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(2));
  });
});
